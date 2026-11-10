import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { writeKeysRemotely } from '../store/__fixtures__/remote-keys.js';
import {
  ADA,
  BOB,
  BODY,
  createFixtureStore,
  createSyncedPair,
  exchange,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import { objectKeyTag } from '../z-order/object-keys.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
  testEnvironment,
} from './__fixtures__/command-fixtures.js';
import { createObjectCommand } from './create-object.js';
import type { newObjectSchema } from './new-object-schema.js';

/** An object as `createObject` takes it, before parsing. */
type NewObjectInput = z.input<typeof newObjectSchema>;

/** A sticky as `createObject` takes it: its own fields and a position. */
const STICKY = {
  type: 'sticky',
  x: 100,
  y: 50,
  width: 200,
  height: 200,
  text: 'Hello',
  runs: [{ length: 5, style: BODY }],
  align: 'center',
  autoWidth: false,
  verticalAlign: 'middle',
  color: [1, 0.92, 0.55, 1],
} satisfies NewObjectInput;

/** A connector as `createObject` takes it, ends to be filled in. */
const CONNECTOR = {
  type: 'connector',
  x: 0,
  y: 0,
  route: 'straight',
  stroke: { color: [0, 0, 0, 1], width: 2 },
  startCap: 'none',
  endCap: 'arrow',
  label: null,
} satisfies Omit<Extract<NewObjectInput, { type: 'connector' }>, 'from' | 'to'>;

describe('createObject', () => {
  it('creates the object with a generated id, on top of its siblings, stamped by the command', () => {
    const store = createFixtureStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, createObjectCommand, { object: STICKY });
    expectDiff(before, store.read(), changes, { created: [result.id] });
    expect(mustGet(store, result.id)).toEqual({
      ...STICKY,
      id: result.id,
      parentId: null,
      pageId: 'page-1',
      rotation: 0,
      z: `a8${objectKeyTag(result.id)}`,
      locked: false,
      createdBy: 'user:ada',
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('keeps a given id, parent and stacking key, and attributes the object to the origin', () => {
    const store = createFixtureStore();
    const { result } = applyCommand(
      store,
      createObjectCommand,
      { object: { ...STICKY, id: 'sticky-new', parentId: 'frame-plan', z: 'a1V', locked: true } },
      BOB,
    );
    expect(result).toEqual({ id: 'sticky-new' });
    expect(mustGet(store, 'sticky-new')).toMatchObject({
      parentId: 'frame-plan',
      z: 'a1V',
      locked: true,
      createdBy: 'user:bob',
    });
  });

  it('places the first child of an empty parent at the first key', () => {
    const store = createFixtureStore();
    applyCommand(store, createObjectCommand, {
      object: { type: 'group', id: 'group-empty', x: 0, y: 0 },
    });
    const { result } = applyCommand(store, createObjectCommand, {
      object: { ...STICKY, parentId: 'group-empty' },
    });
    expect(mustGet(store, result.id)).toMatchObject({ z: `a0${objectKeyTag(result.id)}` });
  });

  it('creates a connector whose ends attach to existing objects', () => {
    const store = createFixtureStore();
    const from = { kind: 'object', objectId: 'image-photo', anchor: null } as const;
    const to = { kind: 'point', x: 5, y: 5 } as const;
    const { result } = applyCommand(store, createObjectCommand, {
      object: { ...CONNECTOR, from, to },
    });
    expect(store.references.connectorsAttachedTo(id('image-photo')).has(result.id)).toBe(true);
  });

  it('rejects an id already in use, without writing', () => {
    const store = createFixtureStore();
    expect(
      expectRejected(store, createObjectCommand, { object: { ...STICKY, id: 'sticky-idea' } }),
    ).toEqual([expect.objectContaining({ code: 'duplicate-id', objectId: 'sticky-idea' })]);
  });

  it('rejects a missing parent, and a parent that cannot hold children', () => {
    const store = createFixtureStore();
    const missing = expectRejected(store, createObjectCommand, {
      object: { ...STICKY, id: 'orphan', parentId: 'nowhere' },
    });
    expect(missing).toEqual([
      expect.objectContaining({ code: 'missing-parent', objectId: 'orphan', path: ['parentId'] }),
    ]);
    const wrongParent = expectRejected(store, createObjectCommand, {
      object: { ...STICKY, parentId: 'sticky-idea' },
    });
    expect(wrongParent).toEqual([expect.objectContaining({ code: 'invalid-parent' })]);
  });

  it('rejects connector ends and comment anchors that break the reference rules', () => {
    const store = createFixtureStore();
    const toMissing = expectRejected(store, createObjectCommand, {
      object: {
        ...CONNECTOR,
        from: { kind: 'object', objectId: 'gone', anchor: null },
        to: { kind: 'object', objectId: 'comment-free', anchor: null },
      },
    });
    expect(toMissing.map((error) => [error.code, error.path])).toEqual([
      ['missing-connector-target', ['from', 'objectId']],
      ['invalid-connector-target', ['to', 'objectId']],
    ]);
    const pinOnPin = expectRejected(store, createObjectCommand, {
      object: {
        type: 'comment',
        x: 0,
        y: 0,
        threadId: 'thread-new',
        anchor: { kind: 'object', objectId: 'comment-free', offset: { x: 0, y: 0 } },
      },
    });
    expect(pinOnPin).toEqual([expect.objectContaining({ code: 'invalid-comment-anchor' })]);
  });

  it('rejects malformed objects and fields the command owns as invalid input', () => {
    const store = createFixtureStore();
    const errorsOf = (object: unknown) =>
      expectRejected(store, createObjectCommand, { object }).map((error) => error.code);
    expect(errorsOf({ ...STICKY, width: -1 })).toEqual(['invalid-input']);
    expect(errorsOf({ ...STICKY, createdBy: 'user:mallory' })).toEqual(['invalid-input']);
    expect(errorsOf({ ...STICKY, updatedAt: 1 })).toEqual(['invalid-input']);
    expect(errorsOf({ ...STICKY, type: 'widget' })).toEqual(['invalid-input']);
    expect(errorsOf({ ...STICKY, runs: [{ length: 4, style: BODY }] })).toEqual(['invalid-object']);
  });

  it('rejects a z that is not a fractional-index key, which would block later placements', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, createObjectCommand, {
      object: { ...STICKY, parentId: 'frame-plan', z: 'b' },
    });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'invalid-input', path: ['object', 'z'] }),
    ]);
    applyCommand(store, createObjectCommand, { object: { ...STICKY, parentId: 'frame-plan' } });
  });

  it('refuses without writing when the top key of the parent is not a fractional-index key', () => {
    const store = createFixtureStore();
    // The schema rejects such a key, but a peer that skips validation can still write one.
    writeKeysRemotely(store, { 'sticky-idea': 'b' });
    const errors = expectRejected(store, createObjectCommand, {
      object: { ...STICKY, parentId: 'frame-plan' },
    });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'unorderable-neighbours', path: ['object', 'z'] }),
    ]);
    const { result } = applyCommand(store, createObjectCommand, {
      object: { ...STICKY, parentId: 'frame-plan', z: 'b00' },
    });
    expect(mustGet(store, result.id).z).toBe('b00');
  });

  it('words a huge stored top key in the refusal by a bounded description', () => {
    const store = createFixtureStore();
    writeKeysRemotely(store, { 'sticky-idea': 'b'.repeat(500_000) });
    const errors = expectRejected(store, createObjectCommand, {
      object: { ...STICKY, parentId: 'frame-plan' },
    });
    expect(errors[0]?.message.length).toBeLessThan(400);
    expect(errors[0]?.message).toContain('characters)');
  });

  it('rejects runs that split a surrogate pair, which the store would refuse mid-transaction', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, createObjectCommand, {
      object: {
        ...STICKY,
        text: 'a😀',
        runs: [
          { length: 2, style: BODY },
          { length: 1, style: { ...BODY, italic: true } },
        ],
      },
    });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'invalid-object', path: ['runs', 1] }),
    ]);
  });

  it('converges when two clients create objects concurrently', () => {
    const [ada, bob] = createSyncedPair();
    const fromAda = applyCommand(
      ada,
      createObjectCommand,
      { object: STICKY },
      ADA,
      testEnvironment(1),
    );
    const fromBob = applyCommand(
      bob,
      createObjectCommand,
      { object: { ...STICKY, parentId: 'frame-plan' } },
      BOB,
      testEnvironment(2),
    );
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.get(fromBob.result.id)).toMatchObject({ createdBy: 'user:bob' });
    expect(bob.get(fromAda.result.id)).toMatchObject({ createdBy: 'user:ada' });
  });
});

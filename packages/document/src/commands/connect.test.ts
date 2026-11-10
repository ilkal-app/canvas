import { describe, expect, it } from 'vitest';

import { writeKeysRemotely } from '../store/__fixtures__/remote-keys.js';
import {
  ADA,
  BOB,
  BODY,
  createFixtureStore,
  createSyncedPair,
  exchange,
  fixtureObject,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import { objectKeyTag } from '../z-order/object-keys.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
} from './__fixtures__/command-fixtures.js';
import { refusalsOn, storedBoardOf } from './__fixtures__/stored-board.js';
import { connectCommand } from './connect.js';
import { moveObjectsCommand } from './move-objects.js';

describe('connect', () => {
  it('connects two objects with a default arrow, on top of the root stack', () => {
    const store = createFixtureStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, connectCommand, {
      from: { objectId: 'sticky-idea' },
      to: { objectId: 'image-photo', anchor: { x: 0, y: 0.5 } },
    });
    expectDiff(before, store.read(), changes, { created: [result.id] });
    expect(mustGet(store, result.id)).toEqual({
      id: result.id,
      type: 'connector',
      parentId: null,
      pageId: 'page-1',
      x: 0,
      y: 0,
      rotation: 0,
      z: `a8${objectKeyTag(result.id)}`,
      locked: false,
      createdBy: 'user:ada',
      createdAt: NOW,
      updatedAt: NOW,
      from: { kind: 'object', objectId: 'sticky-idea', anchor: null },
      to: { kind: 'object', objectId: 'image-photo', anchor: { x: 0, y: 0.5 } },
      route: 'straight',
      stroke: { color: [0.1, 0.1, 0.12, 1], width: 2 },
      startCap: 'none',
      endCap: 'arrow',
      label: null,
    });
    expect(store.references.connectorsAttachedTo(id('image-photo')).has(result.id)).toBe(true);
  });

  it('stores a dash, join, miter limit and cap given with the stroke', () => {
    const store = createFixtureStore();
    const style = {
      strokeDash: { pattern: [8, 8] },
      strokeJoin: 'miter' as const,
      strokeMiterLimit: 6,
      strokeCap: 'square' as const,
    };
    const { result } = applyCommand(store, connectCommand, {
      from: { objectId: 'sticky-idea' },
      to: { point: { x: 900, y: 40 } },
      ...style,
    });
    expect(mustGet(store, result.id)).toMatchObject(style);
  });

  it("stores a free end given in board coordinates in the connector's own frame", () => {
    const store = createFixtureStore();
    const label = { text: 'next', runs: [{ length: 4, style: BODY }] };
    const { result } = applyCommand(store, connectCommand, {
      id: 'connector-new',
      parentId: 'frame-plan',
      from: { point: { x: 0, y: 0 } },
      to: { objectId: 'text-title' },
      route: 'curved',
      startCap: 'circle',
      label,
    });
    expect(result).toEqual({ id: 'connector-new' });
    // The frame's origin is at (-400, -300) on the board.
    expect(mustGet(store, 'connector-new')).toMatchObject({
      parentId: 'frame-plan',
      z: `a3${objectKeyTag(id('connector-new'))}`,
      from: { kind: 'point', x: 400, y: 300 },
      route: 'curved',
      startCap: 'circle',
      label,
    });
  });

  it('rejects missing targets and targets that cannot hold a connector end', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, connectCommand, {
      from: { objectId: 'gone' },
      to: { objectId: 'comment-free' },
    });
    expect(errors.map((error) => [error.code, error.path])).toEqual([
      ['missing-connector-target', ['from', 'objectId']],
      ['invalid-connector-target', ['to', 'objectId']],
    ]);
  });

  it('rejects a bad parent, a taken id and a label splitting an emoji', () => {
    const store = createFixtureStore();
    const ends = { from: { objectId: 'sticky-idea' }, to: { point: { x: 0, y: 0 } } };
    const codesOf = (input: object) =>
      expectRejected(store, connectCommand, { ...ends, ...input }).map((error) => error.code);
    expect(codesOf({ parentId: 'gone' })).toEqual(['missing-parent']);
    expect(codesOf({ parentId: 'sticky-idea' })).toEqual(['invalid-parent']);
    expect(codesOf({ id: 'connector-flow' })).toEqual(['duplicate-id']);
    expect(
      codesOf({
        label: {
          text: 'a😀',
          runs: [
            { length: 2, style: BODY },
            { length: 1, style: { ...BODY, italic: true } },
          ],
        },
      }),
    ).toEqual(['invalid-input']);
  });

  it('draws a free line between two points', () => {
    const store = createFixtureStore();
    const { result } = applyCommand(store, connectCommand, {
      from: { point: { x: 10, y: 20 } },
      to: { point: { x: 110, y: 20 } },
      startCap: 'none',
      endCap: 'none',
    });
    expect(store.get(result.id)).toMatchObject({
      type: 'connector',
      from: { kind: 'point', x: 10, y: 20 },
      to: { kind: 'point', x: 110, y: 20 },
      startCap: 'none',
      endCap: 'none',
    });
  });

  it('rejects a free end in a parent that hangs below a parent cycle', () => {
    const store = createFixtureStore();
    const group = fixtureObject('group-diagram', 'group');
    store.transact(ADA, (transaction) => {
      transaction.setObject({ ...group, id: id('loop-a'), parentId: id('loop-b') });
      transaction.setObject({ ...group, id: id('loop-b'), parentId: id('loop-a') });
      transaction.setObject({ ...group, id: id('hanging'), parentId: id('loop-a') });
    });
    const errors = refusalsOn(storedBoardOf(store), connectCommand, {
      parentId: 'hanging',
      from: { objectId: 'sticky-idea' },
      to: { point: { x: 0, y: 0 } },
    });
    expect(errors).toEqual([expect.objectContaining({ code: 'parent-cycle', path: ['parentId'] })]);
  });

  it('refuses without writing when the top key of the parent is not a fractional-index key', () => {
    const store = createFixtureStore();
    writeKeysRemotely(store, { 'image-photo': 'legacy' });
    const errors = expectRejected(store, connectCommand, {
      from: { objectId: 'sticky-idea' },
      to: { objectId: 'image-photo' },
    });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'unorderable-neighbours', path: ['parentId'] }),
    ]);
  });

  it('converges when one client connects objects while another moves one of them', () => {
    const [ada, bob] = createSyncedPair();
    const { result } = applyCommand(ada, connectCommand, {
      from: { objectId: 'image-photo' },
      to: { objectId: 'video-demo' },
    });
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'video-demo', by: { x: 0, y: 100 } }] },
      BOB,
    );
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(bob.references.connectorsAttachedTo(id('video-demo')).has(result.id)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { z } from 'zod';

import { compareSiblings } from '@canvas/schema';

import { writeKeysRemotely } from '../store/__fixtures__/remote-keys.js';
import { BOB, BODY, createFixtureStore, id } from '../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';
import { objectKeyTag } from '../z-order/object-keys.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
  testEnvironment,
} from './__fixtures__/command-fixtures.js';
import { createObjectsCommand, type createObjectsInputSchema } from './create-objects.js';

/** The input of `createObjects`, before parsing. */
type Input = z.input<typeof createObjectsInputSchema>;

/** One listed object, before parsing. */
type Entry = Input['objects'][number];

/** A listed shape, before parsing. */
type ShapeEntry = Extract<Entry, { type: 'shape' }>;

/**
 * A rectangle, listed under an id.
 *
 * @param listedId - Its id in the list.
 * @param x - Its x, in its parent's frame.
 * @param parentId - Another listed object, or null.
 * @returns The entry.
 */
function rectangle(listedId: string, x: number, parentId: string | null = null): Entry {
  return {
    type: 'shape',
    id: listedId,
    parentId,
    x,
    y: 0,
    width: 40,
    height: 30,
    kind: 'rectangle',
    stroke: null,
    fill: [0.2, 0.4, 0.8, 1],
    cornerRadius: 0,
    sides: 4,
    label: null,
  };
}

/**
 * A connector, listed under an id.
 *
 * @param listedId - Its id in the list.
 * @param from - The object its start is on.
 * @param to - The object its end is on, or a free point.
 * @returns The entry.
 */
function connector(listedId: string, from: string, to: string | { x: number; y: number }): Entry {
  return {
    type: 'connector',
    id: listedId,
    x: 0,
    y: 0,
    from: { kind: 'object', objectId: from, anchor: null },
    to:
      typeof to === 'string'
        ? { kind: 'object', objectId: to, anchor: null }
        : { kind: 'point', ...to },
    route: 'straight',
    stroke: { color: [0, 0, 0, 1], width: 2 },
    startCap: 'none',
    endCap: 'arrow',
    label: null,
  };
}

/** Two runs, bold then regular. */
const TITLE_RUNS = [
  { length: 5, style: { ...BODY, weight: 700 as const } },
  { length: 5, style: BODY },
];

/** A two-run text, bold then regular. */
const STYLED_TEXT: Entry = {
  type: 'text',
  id: 'title',
  x: 0,
  y: 100,
  width: 200,
  height: 40,
  text: 'Bold plain',
  runs: TITLE_RUNS,
  align: 'left',
  autoWidth: true,
  verticalAlign: 'top',
};

describe('createObjects', () => {
  it('creates every object with a fresh id, stacked on top in input order, in one change set', () => {
    const store = createFixtureStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, createObjectsCommand, {
      objects: [rectangle('a', 0), rectangle('b', 50), rectangle('c', 100)],
    });
    expect(result.ids).toHaveLength(3);
    expect(result.ids).not.toContain('a');
    expectDiff(before, store.read(), changes, { created: result.ids });
    const roots = sortedSiblings(store, null);
    expect(roots.slice(-3)).toEqual(result.ids);
    for (const newId of result.ids) {
      expect(mustGet(store, newId)).toMatchObject({
        parentId: null,
        createdBy: 'user:ada',
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(mustGet(store, newId).z.endsWith(objectKeyTag(newId))).toBe(true);
    }
  });

  it('creates a shape and a frame with an outline alignment and a frame outline', () => {
    const store = createFixtureStore();
    const stroke = { color: 'ink' as const, width: 1 };
    const frame: Entry = {
      type: 'frame',
      id: 'panel',
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      name: 'Panel',
      clip: true,
      background: [1, 1, 1, 1],
      stroke,
      strokeAlign: 'inside',
    };
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [
        frame,
        { ...(rectangle('box', 10, 'panel') as ShapeEntry), stroke, strokeAlign: 'outside' },
      ],
    });
    const [panelId, boxId] = result.ids;
    expect(mustGet(store, panelId ?? '')).toMatchObject({ stroke, strokeAlign: 'inside' });
    expect(mustGet(store, boxId ?? '')).toMatchObject({ stroke, strokeAlign: 'outside' });
    const errors = expectRejected(store, createObjectsCommand, {
      objects: [{ ...(rectangle('bad', 0) as ShapeEntry), strokeAlign: 'middle' as never }],
    });
    expect(errors.map((error) => error.code)).toContain('invalid-input');
  });

  it('remaps parents and connector ends inside the list, and nests into the given parent', () => {
    const store = createFixtureStore();
    const { result } = applyCommand(store, createObjectsCommand, {
      parentId: 'frame-plan',
      objects: [
        { type: 'group', id: 'g', x: 10, y: 10 },
        rectangle('a', 0, 'g'),
        rectangle('b', 60, 'g'),
        connector('link', 'a', 'b'),
      ],
    });
    const [group, first, second, link] = result.ids.map((newId) => mustGet(store, newId));
    expect(group).toMatchObject({ type: 'group', parentId: 'frame-plan' });
    expect(first).toMatchObject({ parentId: group?.id });
    expect(second).toMatchObject({ parentId: group?.id });
    expect(link).toMatchObject({
      parentId: 'frame-plan',
      from: { kind: 'object', objectId: first?.id },
      to: { kind: 'object', objectId: second?.id },
    });
    // The group's children stack from the bottom of their new parent, in input order.
    expect(sortedSiblings(store, id(group?.id ?? ''))).toEqual([first?.id, second?.id]);
    // The group and the connector go on top of the frame's children, in input order.
    expect(sortedSiblings(store, id('frame-plan')).slice(-2)).toEqual([group?.id, link?.id]);
  });

  it('nests listed objects in a listed frame, stacked from its bottom in input order', () => {
    const store = createFixtureStore();
    const frame: Entry = {
      type: 'frame',
      id: 'f',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      name: 'Pasted',
      clip: true,
      background: null,
    };
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [frame, rectangle('a', 0, 'f'), rectangle('b', 60, 'f')],
    });
    const [frameId = '', first, second] = result.ids;
    expect(mustGet(store, frameId)).toMatchObject({ type: 'frame', parentId: null });
    expect(sortedSiblings(store, id(frameId))).toEqual([first, second]);
    expect(mustGet(store, first ?? '').z.startsWith('a0')).toBe(true);
  });

  it('refuses a listed parent that cannot hold children, at the child’s entry', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, createObjectsCommand, {
      objects: [rectangle('box', 0), rectangle('inside', 0, 'box')],
    });
    expect(errors.map(({ code, path }) => [code, path])).toEqual([
      ['invalid-parent', ['objects', 1, 'parentId']],
    ]);
  });

  it('writes each object’s placement group whole, beside its own z key', () => {
    const store = createFixtureStore();
    const { result } = applyCommand(store, createObjectsCommand, {
      parentId: 'frame-plan',
      objects: [{ type: 'group', id: 'g', x: 10, y: 20 }, rectangle('a', 5, 'g')],
    });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, store.encodeState());
    const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME);
    for (const newId of result.ids) {
      const stored = mustGet(store, newId);
      const map = objects.get(newId);
      expect(map?.get('placement')).toEqual({
        parentId: stored.parentId,
        pageId: stored.pageId,
        x: stored.x,
        y: stored.y,
        rotation: stored.rotation,
      });
      expect(map?.get('z')).toBe(stored.z);
    }
    doc.destroy();
  });

  it('keeps references to objects on the board that are not listed', () => {
    const store = createFixtureStore();
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [rectangle('a', 0), connector('link', 'a', 'image-photo')],
    });
    const link = mustGet(store, result.ids[1] ?? '');
    expect(link).toMatchObject({ to: { kind: 'object', objectId: 'image-photo' } });
    expect(store.references.connectorsAttachedTo(id('image-photo')).has(link.id)).toBe(true);
  });

  it('keeps text runs and an image asset as given', () => {
    const store = createFixtureStore();
    const photo = mustGet(store, 'image-photo');
    if (photo.type !== 'image') throw new Error('the fixture photo is an image');
    const { id: photoId, z, createdBy, createdAt, updatedAt, ...photoFields } = photo;
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [STYLED_TEXT, { ...photoFields, id: photoId }],
    });
    expect(mustGet(store, result.ids[0] ?? '')).toMatchObject({
      text: 'Bold plain',
      runs: TITLE_RUNS,
    });
    expect(mustGet(store, result.ids[1] ?? '')).toMatchObject({ assetId: photo.assetId });
    expect([z, createdBy, createdAt, updatedAt]).toHaveLength(4);
  });

  it('gives two pastes of the same list distinct ids and keys, the later on top', () => {
    const store = createFixtureStore();
    const input = { objects: [rectangle('a', 0), rectangle('b', 50)] };
    const first = applyCommand(store, createObjectsCommand, input).result.ids;
    const second = applyCommand(store, createObjectsCommand, input, BOB, testEnvironment(8)).result
      .ids;
    expect(new Set([...first, ...second]).size).toBe(4);
    const keys = [...first, ...second].map((newId) => mustGet(store, newId));
    expect([...keys].sort(compareSiblings).map((object) => object.id)).toEqual([
      ...first,
      ...second,
    ]);
  });

  it('refuses a generated id already on the board', () => {
    const store = createFixtureStore();
    const input = { objects: [rectangle('a', 0)] };
    applyCommand(store, createObjectsCommand, input);
    expect(expectRejected(store, createObjectsCommand, input)).toEqual([
      expect.objectContaining({ code: 'duplicate-id', path: ['objects', 0] }),
    ]);
  });

  it('rejects a listed id twice, a given z and a parent outside the list, without writing', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, createObjectsCommand, {
      objects: [
        rectangle('a', 0),
        rectangle('a', 10),
        { ...rectangle('b', 0), z: 'a0' },
        rectangle('c', 0, 'frame-plan'),
      ],
    });
    expect(errors.map(({ code, path }) => [code, path])).toEqual([
      ['duplicate-id', ['objects', 1, 'id']],
      ['invalid-input', ['objects', 2, 'z']],
      ['missing-parent', ['objects', 3, 'parentId']],
    ]);
  });

  it('rejects invalid objects and broken references at the entry that makes them', () => {
    const store = createFixtureStore();
    const badRuns = { ...STYLED_TEXT, runs: [{ length: 3, style: BODY }] };
    const errors = expectRejected(store, createObjectsCommand, {
      objects: [rectangle('a', 0), badRuns, connector('link', 'a', 'nowhere')],
    });
    expect(errors.map(({ code, path }) => [code, path.slice(0, 2)])).toEqual([
      ['invalid-object', ['objects', 1]],
    ]);
    const references = expectRejected(store, createObjectsCommand, {
      objects: [rectangle('a', 0), connector('link', 'a', 'nowhere')],
    });
    expect(references.map(({ code, path }) => [code, path])).toEqual([
      ['missing-connector-target', ['objects', 1, 'to', 'objectId']],
    ]);
  });

  it('rejects a target parent that is missing or cannot hold children, and a listed parent cycle', () => {
    const store = createFixtureStore();
    const missing = expectRejected(store, createObjectsCommand, {
      parentId: 'nowhere',
      objects: [rectangle('a', 0)],
    });
    expect(missing.map(({ code }) => code)).toEqual(['missing-parent']);
    const notContainer = expectRejected(store, createObjectsCommand, {
      parentId: 'sticky-idea',
      objects: [rectangle('a', 0)],
    });
    expect(notContainer.map(({ code }) => code)).toEqual(['invalid-parent']);
    const cycle = expectRejected(store, createObjectsCommand, {
      objects: [
        { type: 'group', id: 'g', parentId: 'h', x: 0, y: 0 },
        { type: 'group', id: 'h', parentId: 'g', x: 0, y: 0 },
      ],
    });
    expect(cycle.map(({ code }) => code)).toContain('parent-cycle');
  });

  it('refuses to stack on a parent whose top key is not a fractional-index key', () => {
    const store = createFixtureStore();
    writeKeysRemotely(store, { 'image-photo': 'not-a-key' });
    const errors = expectRejected(store, createObjectsCommand, { objects: [rectangle('a', 0)] });
    expect(errors.map(({ code }) => code)).toEqual(['unorderable-neighbours']);
  });

  it('rejects an empty list and unknown keys in the input', () => {
    const store = createFixtureStore();
    expect(expectRejected(store, createObjectsCommand, { objects: [] })[0]?.code).toBe(
      'invalid-input',
    );
    expect(
      expectRejected(store, createObjectsCommand, { objects: [rectangle('a', 0)], extra: 1 })[0]
        ?.code,
    ).toBe('invalid-input');
  });
});

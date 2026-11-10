import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import type { BoardObjectOf, Segment, Vertex } from '@canvas/schema';

import { hiddenMembers } from '../codec/network-visibility.js';
import { createHistory } from '../history/undo-manager.js';
import { ADA, createFixtureStore, fixtureObject } from '../store/__fixtures__/store-fixtures.js';
import { internalsOf } from '../store/internal.js';

import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
} from './__fixtures__/command-fixtures.js';
import { editMembers, editNetworkCommand } from './edit-network.js';
import { setLockedCommand } from './set-locked.js';
import { setStyleCommand } from './set-style.js';

// The fixture board's `path-squiggle`: v1 (0, 0) — s1 — v2 (100, 0) — s2 — v3 (200, 50).
const PATH = 'path-squiggle';

/**
 * The fixture path as a store holds it.
 *
 * @param store - The store.
 * @returns The path.
 * @throws {Error} When the object is not a path.
 */
function pathOf(store: ReturnType<typeof createFixtureStore>): BoardObjectOf<'path'> {
  const object = mustGet(store, PATH);
  if (object.type !== 'path') throw new Error('not a path');
  return object;
}

/**
 * The fixture path's stored map.
 *
 * @param store - The store.
 * @returns The map.
 */
function storedPath(store: ReturnType<typeof createFixtureStore>): Y.Map<unknown> {
  return internalsOf(store).doc.getMap('objects').get(PATH) as Y.Map<unknown>;
}

const V4: Vertex = { id: 'v4', x: 300, y: 0, mirror: 'none' };
const S3: Segment = { id: 's3', a: 'v3', b: 'v4', ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } };

describe('editNetwork', () => {
  it('replaces a vertex by id, writing only the path', () => {
    const store = createFixtureStore();
    const before = store.read();
    const original = fixtureObject(PATH, 'path');
    const moved: Vertex = { id: 'v2', x: 120, y: -10, mirror: 'both' };
    const { result, changes } = applyCommand(store, editNetworkCommand, {
      id: PATH,
      setVertices: [moved],
    });
    expect(result).toEqual({ id: PATH });
    expectDiff(before, store.read(), changes, { updated: [PATH] });
    expect(pathOf(store)).toEqual({
      ...original,
      vertices: [original.vertices[0], moved, original.vertices[2]],
      updatedAt: NOW,
    });
  });

  it('appends new members in input order, keeping the others where they were', () => {
    const store = createFixtureStore();
    const original = fixtureObject(PATH, 'path');
    applyCommand(store, editNetworkCommand, { id: PATH, setVertices: [V4], setSegments: [S3] });
    expect(pathOf(store).vertices).toEqual([...original.vertices, V4]);
    expect(pathOf(store).segments).toEqual([...original.segments, S3]);
  });

  it('deletes a vertex with the segments ending at it', () => {
    const store = createFixtureStore();
    applyCommand(store, editNetworkCommand, {
      id: PATH,
      deleteVertexIds: ['v3'],
      deleteSegmentIds: ['s2'],
    });
    expect(pathOf(store).vertices.map(({ id }) => id)).toEqual(['v1', 'v2']);
    expect(pathOf(store).segments.map(({ id }) => id)).toEqual(['s1']);
  });

  it('splits a segment in one edit: a new vertex, the segment shortened, a new segment', () => {
    const store = createFixtureStore();
    const middle: Vertex = { id: 'v9', x: 50, y: -10, mirror: 'angle' };
    applyCommand(store, editNetworkCommand, {
      id: PATH,
      setVertices: [middle],
      setSegments: [
        { id: 's1', a: 'v1', b: 'v9', ha: { x: 0, y: 0 }, hb: { x: -10, y: 0 } },
        { id: 's9', a: 'v9', b: 'v2', ha: { x: 10, y: 0 }, hb: { x: -30, y: -40 } },
      ],
    });
    expect(pathOf(store).segments.map(({ a, b }) => `${a}-${b}`)).toEqual([
      'v1-v9',
      'v2-v3',
      'v9-v2',
    ]);
  });

  it('refuses a missing object, another type and a locked path', () => {
    const store = createFixtureStore();
    expect(
      expectRejected(store, editNetworkCommand, { id: 'nope' }).map(({ code }) => code),
    ).toEqual(['missing-object']);
    expect(
      expectRejected(store, editNetworkCommand, { id: 'shape-box' }).map(({ code }) => code),
    ).toEqual(['unsupported-type']);
    applyCommand(store, setLockedCommand, { ids: [PATH], locked: true });
    expect(
      expectRejected(store, editNetworkCommand, { id: PATH, setVertices: [V4] }).map(
        ({ code }) => code,
      ),
    ).toEqual(['locked']);
  });

  it('refuses a network the schema rejects, whole', () => {
    const store = createFixtureStore();
    const dangling = expectRejected(store, editNetworkCommand, { id: PATH, setSegments: [S3] });
    expect(dangling.map(({ code }) => code)).toEqual(['invalid-object']);
    expect(dangling[0]?.message).toContain('missing vertex "v4"');
    const leftBehind = expectRejected(store, editNetworkCommand, {
      id: PATH,
      deleteVertexIds: ['v3'],
    });
    expect(leftBehind.map(({ code }) => code)).toEqual(['invalid-object']);
    const twice = expectRejected(store, editNetworkCommand, {
      id: PATH,
      setSegments: [{ ...S3, id: 's4', a: 'v1', b: 'v2' }],
    });
    expect(twice[0]?.message).toContain('already joined');
  });

  it('refuses ids listed twice, set and deleted, or not in the network', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, editNetworkCommand, {
      id: PATH,
      setVertices: [V4, V4],
      deleteSegmentIds: ['s1', 's1', 'nope'],
      setSegments: [{ ...S3, id: 's1' }],
    });
    expect(errors.map(({ code, path }) => [code, path])).toEqual([
      ['invalid-input', ['setVertices', 1]],
      ['invalid-input', ['deleteSegmentIds', 0]],
      ['invalid-input', ['deleteSegmentIds', 1]],
      ['invalid-input', ['deleteSegmentIds', 2]],
    ]);
  });

  it('refuses a new vertex that joins no segment, and deletes an existing one it leaves so', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, editNetworkCommand, { id: PATH, setVertices: [V4] });
    expect(errors.map(({ code, path }) => [code, path])).toEqual([
      ['invalid-input', ['setVertices', 0]],
    ]);
    expect(errors[0]?.message).toContain('joins no segment');
    // A segment deleted alone takes the end it leaves joined to nothing (a read would hide it).
    const history = createHistory(store, ADA.principalId);
    applyCommand(store, editNetworkCommand, { id: PATH, deleteSegmentIds: ['s2'] });
    expect(pathOf(store).vertices.map(({ id }) => id)).toEqual(['v1', 'v2']);
    expect(hiddenMembers(storedPath(store))).toEqual({ vertices: new Set(), segments: new Set() });
    history.undo();
    expect(pathOf(store)).toMatchObject(fixtureObject(PATH, 'path'));
  });

  it('adds a lone vertex to a path with no segment, whose vertices a read shows', () => {
    const store = createFixtureStore();
    applyCommand(store, editNetworkCommand, {
      id: PATH,
      deleteSegmentIds: ['s1', 's2'],
      setVertices: [V4],
    });
    expect(pathOf(store).vertices.map(({ id }) => id)).toEqual(['v1', 'v2', 'v3', 'v4']);
  });

  it('refuses a malformed input', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, editNetworkCommand, {
      id: PATH,
      setVertices: [{ id: 'v5', x: 0, y: 0 }],
    });
    expect(errors.map(({ code }) => code)).toEqual(['invalid-input']);
  });
});

describe('editMembers', () => {
  it('deletes, replaces in place and appends, without changing its inputs', () => {
    const members = Object.freeze([{ id: 'a' }, { id: 'b', n: 1 }, { id: 'c' }]);
    const set = Object.freeze([{ id: 'd' }, { id: 'b', n: 2 }]);
    expect(editMembers(members, ['a'], set)).toEqual([{ id: 'b', n: 2 }, { id: 'c' }, { id: 'd' }]);
    expect(members).toEqual([{ id: 'a' }, { id: 'b', n: 1 }, { id: 'c' }]);
  });
});

describe('editNetwork with path data', () => {
  it('replaces the whole network in the path frame and keeps its place', () => {
    const store = createFixtureStore();
    const before = pathOf(store);
    applyCommand(store, editNetworkCommand, { id: PATH, d: 'M0 0 L10 0 L10 10' });
    const after = pathOf(store);
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    // The new members take ids under a fresh prefix, which no stored member can hold.
    const [prefix] = after.vertices[0]?.id.split('-') ?? [];
    expect(prefix).toMatch(/^.{1,16}$/);
    expect(after.vertices.map(({ id, x, y }) => [id, x, y])).toEqual([
      [`${String(prefix)}-v0`, 0, 0],
      [`${String(prefix)}-v1`, 10, 0],
      [`${String(prefix)}-v2`, 10, 10],
    ]);
    expect(after.segments.map(({ id, a, b }) => [id, a, b])).toEqual([
      [`${String(prefix)}-s0`, `${String(prefix)}-v0`, `${String(prefix)}-v1`],
      [`${String(prefix)}-s1`, `${String(prefix)}-v1`, `${String(prefix)}-v2`],
    ]);
  });

  it('refuses path data beside a list, even an empty one, naming the lists', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, editNetworkCommand, {
      id: PATH,
      d: 'M0 0 L10 0',
      setVertices: [],
      deleteSegmentIds: [],
    });
    expect(errors).toEqual([
      expect.objectContaining({
        code: 'invalid-input',
        path: ['d'],
        message: 'd replaces the whole network: give it without setVertices, deleteSegmentIds',
      }),
    ]);
  });

  it('refuses malformed path data, and keeps an open subpath open under a fill', () => {
    const store = createFixtureStore();
    const malformed = expectRejected(store, editNetworkCommand, { id: PATH, d: 'M0 0 L10' });
    expect(malformed).toEqual([
      expect.objectContaining({
        path: ['d'],
        message: 'path data: command "L" is missing numbers at offset 8',
      }),
    ]);
    applyCommand(store, setStyleCommand, {
      changes: [{ id: PATH, style: { fill: [1, 0, 0, 1] } }],
    });
    applyCommand(store, editNetworkCommand, { id: PATH, d: 'M0 0 L10 0 L10 10' });
    expect(pathOf(store).segments).toHaveLength(2);
  });
});

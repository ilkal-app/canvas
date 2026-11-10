import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { findNetworkIssues, type BoardObjectOf, type Segment, type Vertex } from '@canvas/schema';

import { fixtureObject } from '../store/__fixtures__/store-fixtures.js';

import {
  hiddenMembers,
  hiddenMembersOf,
  visibleNetwork,
  wouldDeleteMembers,
} from './network-visibility.js';
import { fromYjs, toYjs, writeObject } from './object-codec.js';

const ZERO = { x: 0, y: 0 };
const V1: Vertex = { id: 'v1', x: 0, y: 0, mirror: 'none' };
const V2: Vertex = { id: 'v2', x: 100, y: 0, mirror: 'none' };
const V3: Vertex = { id: 'v3', x: 200, y: 50, mirror: 'none' };
const S1: Segment = { id: 's1', a: 'v1', b: 'v2', ha: ZERO, hb: ZERO };
const S2: Segment = { id: 's2', a: 'v2', b: 'v3', ha: ZERO, hb: ZERO };

/**
 * The fixture path (v1 — s1 — v2 — s2 — v3) with another network.
 *
 * @param vertices - The vertices.
 * @param segments - The segments.
 * @returns The path.
 */
function pathWith(vertices: Vertex[], segments: Segment[]): BoardObjectOf<'path'> {
  return { ...fixtureObject('path-squiggle', 'path'), vertices, segments };
}

/**
 * A path stored in a document, as a merge could leave it (not validated).
 *
 * @param path - The path.
 * @returns Its integrated map.
 */
function storedPath(path: BoardObjectOf<'path'>): Y.Map<unknown> {
  const objects = new Y.Doc().getMap<unknown>('objects');
  objects.set(path.id, toYjs(path));
  return objects.get(path.id) as Y.Map<unknown>;
}

/**
 * Reads a stored path back.
 *
 * @param map - Its map.
 * @returns The decoded path.
 * @throws {Error} When it does not decode to a path.
 */
function readPath(map: Y.Map<unknown>): BoardObjectOf<'path'> {
  const decoded = fromYjs('path-squiggle', map);
  if (!('object' in decoded) || decoded.object.type !== 'path') throw new Error('not a path');
  return decoded.object;
}

describe('visibleNetwork', () => {
  it('returns a well-formed network itself', () => {
    const network = { vertices: [V1, V2, V3], segments: [S1, S2] };
    expect(visibleNetwork(network)).toBe(network);
  });

  it('leaves out a segment ending at a missing vertex, and one joining a vertex to itself', () => {
    const loop = { ...S1, id: 's0', b: 'v1' };
    const visible = visibleNetwork({ vertices: [V1, V2], segments: [loop, S1, S2] });
    expect(visible.segments).toEqual([S1]);
    expect(visible.vertices).toEqual([V1, V2]);
  });

  it('shows the lowest id of the segments joining one pair, in either direction', () => {
    const later = { ...S2, id: 'z', a: 'v3', b: 'v2' };
    const earlier = { ...S2, id: 'b' };
    const visible = visibleNetwork({ vertices: [V1, V2, V3], segments: [later, S1, earlier] });
    expect(visible.segments).toEqual([S1, earlier]);
    expect(findNetworkIssues(visible.vertices as Vertex[], visible.segments as Segment[])).toEqual(
      [],
    );
  });

  it('keeps pairs of ids apart whose characters run together', () => {
    const vertices = ['a', 'bc', 'ab', 'c'].map((id) => ({ ...V1, id }));
    const segments = [
      { ...S1, id: 's1', a: 'a', b: 'bc' },
      { ...S1, id: 's2', a: 'ab', b: 'c' },
    ];
    const network = { vertices, segments };
    expect(visibleNetwork(network)).toBe(network);
  });

  it('drops vertices no segment touches once the network has a segment', () => {
    const stray = { ...V1, id: 'v9' };
    expect(visibleNetwork({ vertices: [V1, stray, V2], segments: [S1] }).vertices).toEqual([
      V1,
      V2,
    ]);
    const dangling = { vertices: [V1, V2], segments: [{ ...S1, b: 'gone' }, S2] };
    expect(visibleNetwork(dangling)).toEqual({ vertices: [V1, V2], segments: [] });
  });

  it('keeps every vertex of a network with no segment', () => {
    const network = { vertices: [V1, V2], segments: [] };
    expect(visibleNetwork(network)).toBe(network);
  });
});

describe('hidden members', () => {
  it('lists what a read leaves out, per list', () => {
    const hidden = hiddenMembersOf({
      vertices: [V1, V2, { ...V3, id: 'v9' }],
      segments: [S1, { ...S2, b: 'v3' }],
    });
    expect([...hidden.vertices]).toEqual(['v9']);
    expect([...hidden.segments]).toEqual(['s2']);
    expect(hiddenMembersOf({ vertices: [V1, V2], segments: [S1] }).segments.size).toBe(0);
  });

  it('reads a stored map, and hides nothing when a list cannot be read', () => {
    const map = storedPath(pathWith([V1, V2], [S1, S2]));
    expect([...hiddenMembers(map).segments]).toEqual(['s2']);
    map.set('segments', 'broken');
    expect(hiddenMembers(map)).toEqual({ vertices: new Set(), segments: new Set() });
  });

  it('knows when a write would delete a member', () => {
    const map = storedPath(pathWith([V1, V2], [S1]));
    expect(wouldDeleteMembers(map.get('vertices'), new Set(['v1', 'v2', 'v3']))).toBe(false);
    expect(wouldDeleteMembers(map.get('vertices'), new Set(['v1']))).toBe(true);
    expect(wouldDeleteMembers(undefined, new Set())).toBe(false);
  });
});

describe('paths in the document', () => {
  it('read with the network rules applied, the members staying stored', () => {
    const map = storedPath(pathWith([V1, V2], [S1, S2]));
    expect(readPath(map).segments).toEqual([S1]);
    (map.get('vertices') as Y.Map<unknown>).set('v3', [2, V3]);
    expect(readPath(map).segments).toEqual([S1, S2]);
  });

  it('keep the members a read leaves out when the path is written', () => {
    const map = storedPath(pathWith([V1, V2], [S1, S2]));
    const moved = { ...readPath(map), vertices: [V1, { ...V2, y: 30 }] };
    writeObject(map, moved);
    expect((map.get('segments') as Y.Map<unknown>).has('s2')).toBe(true);
    writeObject(map, { ...moved, vertices: [V1, V2, V3], segments: [S1, S2] });
    writeObject(map, { ...moved, vertices: [V1, V2], segments: [S1] });
    expect((map.get('segments') as Y.Map<unknown>).has('s2')).toBe(false);
    expect((map.get('vertices') as Y.Map<unknown>).has('v3')).toBe(false);
  });
});

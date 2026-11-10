import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { BoardObjectOf, Segment, Vertex } from '@canvas/schema';

import { fixtureObject } from '../store/__fixtures__/store-fixtures.js';

import { collectedSegments, memberWrite } from './network-collection.js';
import { hiddenMembers } from './network-visibility.js';
import { fromYjs, toYjs, writeObject } from './object-codec.js';

const ZERO = { x: 0, y: 0 };
const V1: Vertex = { id: 'v1', x: 0, y: 0, mirror: 'none' };
const V2: Vertex = { id: 'v2', x: 100, y: 0, mirror: 'none' };
const V3: Vertex = { id: 'v3', x: 200, y: 50, mirror: 'none' };
const S1: Segment = { id: 's1', a: 'v1', b: 'v2', ha: ZERO, hb: ZERO };
const S2: Segment = { id: 's2', a: 'v2', b: 'v3', ha: ZERO, hb: ZERO };

/**
 * The fixture path, stored with a network as a merge could leave it (not validated).
 *
 * @param vertices - The stored vertices.
 * @param segments - The stored segments.
 * @returns Its integrated map.
 */
function storedPath(vertices: Vertex[], segments: Segment[]): Y.Map<unknown> {
  const objects = new Y.Doc().getMap<unknown>('objects');
  const path: BoardObjectOf<'path'> = {
    ...fixtureObject('path-squiggle', 'path'),
    vertices,
    segments,
  };
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

/**
 * The ids stored under a network key.
 *
 * @param map - The path's map.
 * @param key - Which list.
 * @returns The stored ids, sorted.
 */
function storedIds(map: Y.Map<unknown>, key: 'vertices' | 'segments'): string[] {
  return [...(map.get(key) as Y.Map<unknown>).keys()].sort();
}

describe('a write of a path collects', () => {
  it('the stored segments ending at a vertex it deletes whose other end is stored', () => {
    // z duplicates s2 (hidden); the write deletes v3 with s2.
    const map = storedPath([V1, V2, V3], [S1, S2, { ...S2, id: 'z' }]);
    const collected = collectedSegments(map.get('segments') as Y.Map<unknown>, {
      ...memberWrite(map.get('vertices') as Y.Map<unknown>, {}),
      deletedVertexIds: new Set(['v3']),
      writtenSegmentIds: new Set(['s1', 's2']),
    });
    expect(collected).toEqual(new Set(['z']));
    writeObject(map, { ...readPath(map), vertices: [V1, V2], segments: [S1] });
    expect(storedIds(map, 'segments')).toEqual(['s1']);
    expect(hiddenMembers(map).segments.size).toBe(0);
  });

  it('not a segment waiting for its other end, even when it deletes the end it has', () => {
    // s9 ends at v3 and at a vertex someone else deleted: an undo may bring that back.
    const map = storedPath([V1, V2, V3], [S1, S2, { ...S2, id: 's9', a: 'gone' }]);
    writeObject(map, { ...readPath(map), vertices: [V1, V2], segments: [S1] });
    expect(storedIds(map, 'segments')).toEqual(['s1', 's9']);
  });

  it('the stored segments ending at a vertex id it creates', () => {
    // s2 waits for v3, which is gone; a new vertex under the id v3 is not that vertex.
    const map = storedPath([V1, V2], [S1, S2]);
    const fresh = { ...V3, x: 500, y: 500 };
    const joining = { ...S1, id: 'sX', a: 'v1', b: 'v3' };
    writeObject(map, { ...readPath(map), vertices: [V1, V2, fresh], segments: [S1, joining] });
    expect(storedIds(map, 'segments')).toEqual(['s1', 'sX']);
    expect(readPath(map).segments).toEqual([S1, joining]);
  });

  it('the stored duplicates of a shown segment it deletes, in either direction', () => {
    const duplicate = { ...S2, id: 'z', a: 'v3', b: 'v2' };
    const map = storedPath([V1, V2, V3], [S1, S2, duplicate]);
    writeObject(map, { ...readPath(map), vertices: [V1, V2], segments: [S1] });
    expect(storedIds(map, 'segments')).toEqual(['s1']);
  });

  it('nothing else: a segment waiting for a vertex someone else deleted stays', () => {
    const map = storedPath([V1, V2], [S1, S2]);
    writeObject(map, { ...readPath(map), vertices: [V1, { ...V2, y: 30 }] });
    writeObject(map, { ...readPath(map), segments: [], vertices: [V1, V2] });
    expect(storedIds(map, 'segments')).toEqual(['s2']);
  });

  it('nothing when the write lists the segment', () => {
    const map = storedPath([V1, V2], [S1, S2]);
    const joined = { ...S2, a: 'v1' };
    writeObject(map, { ...readPath(map), vertices: [V1, V2, V3], segments: [S1, joined] });
    expect(readPath(map).segments).toEqual([S1, joined]);
  });
});

describe('collectedSegments', () => {
  it('skips a malformed stored member and one the write deletes itself', () => {
    const map = storedPath([V1, V2, V3], [S1, S2]);
    (map.get('segments') as Y.Map<unknown>).set('bad', 'not a member');
    const write = memberWrite(map.get('vertices') as Y.Map<unknown>, {
      deletedSegmentIds: new Set(['s2', 'bad']),
    });
    const segments = map.get('segments') as Y.Map<unknown>;
    expect(collectedSegments(segments, write)).toEqual(new Set());
    const other = memberWrite(map.get('vertices') as Y.Map<unknown>, {
      deletedSegmentIds: new Set(['s2']),
    });
    expect(collectedSegments(segments, other)).toEqual(new Set());
  });
});

import { expect } from 'vitest';
import type * as Y from 'yjs';

import {
  findNetworkIssues,
  validateBoard,
  type BoardObjectOf,
  type Segment,
  type Vertex,
} from '@canvas/schema';

import { readNetworkMap } from '../../codec/network-codec.js';
import type { TransactionOrigin } from '../../origin/transaction-origin.js';
import {
  ADA,
  fixtureObject,
  id,
  unreadableEntries,
} from '../../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../../store/document-store.js';
import { internalsOf } from '../../store/internal.js';

// A vector network member is a key of its network's `Y.Map` (one per vertex, one per segment),
// the one kind of key that is added and removed after its object was created, so it is where an
// undo or redo re-creates a key and must be able to remove it again. The fixture path
// is v1 —s1— v2 —s2— v3.

/** The fixture path's id. */
export const PATH_ID = id('path-squiggle');

/** The fixture path as the fixture board holds it. */
export const PATH = fixtureObject('path-squiggle', 'path');

/** A vertex added past the path's end. */
export const ADDED_VERTEX: Vertex = { id: 'v4', x: 300, y: 0, mirror: 'none' };

/** The segment joining {@link ADDED_VERTEX} to v3. */
export const ADDED_SEGMENT: Segment = {
  id: 's3',
  a: 'v3',
  b: 'v4',
  ha: { x: 0, y: 0 },
  hb: { x: 0, y: 0 },
};

/**
 * Reads the fixture path.
 *
 * @param store - The store.
 * @returns The path.
 * @throws {Error} When the path cannot be read.
 */
export function pathOf(store: DocumentStore): BoardObjectOf<'path'> {
  const path = store.get(PATH_ID);
  if (path?.type !== 'path') throw new Error('The fixture path cannot be read');
  return path;
}

/**
 * The path's network by member id as stored: vertex positions and segment ends. Read from the
 * document's network maps, not the decoded path, because a read leaves out a member a network
 * rule hides (a vertex no segment touches,'s `codec/network-visibility.ts`), and these
 * tests judge which values the undo guard keeps in the document.
 *
 * @param store - The store.
 * @returns One line per member, sorted.
 */
export function membersOf(store: DocumentStore): string[] {
  pathOf(store);
  const map = internalsOf(store).objects.get(PATH_ID) as Y.Map<unknown>;
  const list = (key: 'vertices' | 'segments') =>
    readNetworkMap(map.get(key)) as unknown as readonly Record<string, unknown>[];
  const vertices = list('vertices') as unknown as readonly Vertex[];
  const segments = list('segments') as unknown as readonly Segment[];
  return [
    ...vertices.map((vertex) => `${vertex.id}@${String(vertex.x)},${String(vertex.y)}`),
    ...segments.map((segment) => `${segment.id}:${segment.a}-${segment.b}`),
  ].sort();
}

/**
 * Adds v4 and the segment s3 from v3 to it, as one step.
 *
 * @param store - The store.
 * @param origin - Who adds them; Ada by default.
 */
export function addMember(store: DocumentStore, origin: TransactionOrigin = ADA): void {
  store.transact(origin, (transaction) => {
    transaction.setVertex(PATH_ID, ADDED_VERTEX);
    transaction.setSegment(PATH_ID, ADDED_SEGMENT);
  });
}

/**
 * Deletes the path's end, v3 and the segment s2 to it, as one step.
 *
 * @param store - The store.
 * @param origin - Who deletes them; Ada by default.
 */
export function deleteEnd(store: DocumentStore, origin: TransactionOrigin = ADA): void {
  store.transact(origin, (transaction) => {
    transaction.deleteSegment(PATH_ID, 's2');
    transaction.deleteVertex(PATH_ID, 'v3');
  });
}

/**
 * Moves a vertex, overwriting its member.
 *
 * @param store - The store.
 * @param vertexId - The vertex.
 * @param x - Its new x, path units.
 * @param origin - Who moves it; Ada by default.
 * @throws {Error} When the path has no such vertex.
 */
export function moveVertex(
  store: DocumentStore,
  vertexId: string,
  x: number,
  origin: TransactionOrigin = ADA,
): void {
  const vertex = pathOf(store).vertices.find((candidate) => candidate.id === vertexId);
  if (vertex === undefined) throw new Error(`No vertex ${vertexId}`);
  store.transact(origin, (transaction) => {
    transaction.setVertex(PATH_ID, { ...vertex, x });
  });
}

/**
 * Checks a store's board can be read whole, keeps the board rules, and its path's network is
 * well formed.
 *
 * @param store - The store.
 */
export function expectValidBoard(store: DocumentStore): void {
  expect(unreadableEntries(store)).toEqual([]);
  expect(validateBoard(store.read())).toEqual([]);
  const path = pathOf(store);
  expect(findNetworkIssues(path.vertices, path.segments)).toEqual([]);
}

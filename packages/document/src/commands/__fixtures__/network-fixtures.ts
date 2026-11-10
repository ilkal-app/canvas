// Helpers of the `editNetwork` sync tests: the fixture path as each client holds it,
// edits as Ada or Bob, and the check that both converged on a well-formed network.
import { expect } from 'vitest';
import type * as Y from 'yjs';

import { findNetworkIssues, type BoardObjectOf, type Segment, type Vertex } from '@canvas/schema';

import {
  BOB_ENVIRONMENT,
  expectValidAndConverged,
} from '../../repair/__fixtures__/repair-fixtures.js';
import { BOB } from '../../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../../store/document-store.js';
import { internalsOf } from '../../store/internal.js';
import type { YjsDocumentStore } from '../../store/yjs-document-store.js';
import { editNetworkCommand, type EditNetworkInput } from '../edit-network.js';

import { applyCommand, mustGet } from './command-fixtures.js';

/** The fixture board's `path-squiggle`: v1 (0, 0) — s1 — v2 (100, 0) — s2 — v3 (200, 50). */
export const PATH = 'path-squiggle';
/** A zero handle. */
export const ZERO = { x: 0, y: 0 };

/**
 * The fixture path as a store holds it.
 *
 * @param store - The store.
 * @returns The path.
 * @throws {Error} When the object is not a path.
 */
export function pathOf(store: DocumentStore): BoardObjectOf<'path'> {
  const object = mustGet(store, PATH);
  if (object.type !== 'path') throw new Error('not a path');
  return object;
}

/**
 * A vertex of the fixture path as a store holds it, moved.
 *
 * @param store - The store.
 * @param vertexId - The vertex.
 * @param x - Its new x.
 * @param y - Its new y.
 * @returns The moved vertex.
 * @throws {Error} When the path has no such vertex.
 */
export function moved(store: DocumentStore, vertexId: string, x: number, y: number): Vertex {
  const vertex = pathOf(store).vertices.find(({ id }) => id === vertexId);
  if (vertex === undefined) throw new Error(`no vertex ${vertexId}`);
  return { ...vertex, x, y };
}

/**
 * A segment of the fixture path as a store holds it, changed.
 *
 * @param store - The store.
 * @param segmentId - The segment.
 * @param change - The fields to change.
 * @returns The changed segment.
 * @throws {Error} When the path has no such segment.
 */
export function changed(
  store: DocumentStore,
  segmentId: string,
  change: Partial<Segment>,
): Segment {
  const segment = pathOf(store).segments.find(({ id }) => id === segmentId);
  if (segment === undefined) throw new Error(`no segment ${segmentId}`);
  return { ...segment, ...change };
}

/**
 * Runs an edit as Ada.
 *
 * @param store - Ada's store.
 * @param edit - The edit, without the path id.
 */
export function adaEdits(store: DocumentStore, edit: Partial<EditNetworkInput>): void {
  applyCommand(store, editNetworkCommand, { id: PATH, ...edit });
}

/**
 * Runs an edit as Bob.
 *
 * @param store - Bob's store.
 * @param edit - The edit, without the path id.
 */
export function bobEdits(store: DocumentStore, edit: Partial<EditNetworkInput>): void {
  applyCommand(store, editNetworkCommand, { id: PATH, ...edit }, BOB, BOB_ENVIRONMENT);
}

/**
 * Checks both clients converged on a valid board whose path is readable with a well-formed
 * network.
 *
 * @param ada - One client.
 * @param bob - The other.
 * @returns The path both hold.
 */
export function expectConvergedPath(
  ada: YjsDocumentStore,
  bob: YjsDocumentStore,
): BoardObjectOf<'path'> {
  expectValidAndConverged(ada, bob);
  const path = pathOf(ada);
  expect(findNetworkIssues(path.vertices, path.segments)).toEqual([]);
  return path;
}

/**
 * The ids of a path's members, sorted.
 *
 * @param members - The vertices or segments.
 * @returns Their ids.
 */
export function idsOf(members: readonly { readonly id: string }[]): string[] {
  return members.map(({ id }) => id).sort();
}

/**
 * The ids stored under one of the fixture path's network keys, whether a read shows them or not.
 *
 * @param store - The store.
 * @param key - Which list.
 * @returns The stored ids, sorted.
 */
export function storedIds(store: DocumentStore, key: 'vertices' | 'segments'): string[] {
  const path = internalsOf(store).doc.getMap('objects').get(PATH) as Y.Map<unknown>;
  return [...(path.get(key) as Y.Map<unknown>).keys()].sort();
}

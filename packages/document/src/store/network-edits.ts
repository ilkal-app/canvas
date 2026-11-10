import type * as Y from 'yjs';

import {
  findNetworkIssues,
  segmentSchema,
  vertexSchema,
  type BoardObjectOf,
  type Segment,
  type Vertex,
} from '@canvas/schema';

import {
  deleteNetworkItem,
  readNetworkMap,
  upsertNetworkItem,
  type NetworkItem,
} from '../codec/network-codec.js';
import { collectedSegments, memberWrite, type NetworkWrite } from '../codec/network-collection.js';

import { DocumentWriteError } from './document-write-error.js';

/** A path's map with the path as it is now. */
export interface PathTarget {
  /** The path's map. */
  readonly map: Y.Map<unknown>;
  /** The path as it is now. */
  readonly path: BoardObjectOf<'path'>;
}

/**
 * A path to edit member by member: the decoded path with every stored vertex, those a read
 * leaves out for joining no segment included (`codec/network-visibility.ts`), so a vertex set in
 * one call can be joined by a segment in the next.
 *
 * @param map - The path's map.
 * @param path - The path as decoded.
 * @returns The target.
 */
export function pathTargetOf(map: Y.Map<unknown>, path: BoardObjectOf<'path'>): PathTarget {
  // The path decoded, so its vertex map reads as a list of vertices.
  const vertices = readNetworkMap(map.get('vertices')) as unknown as Vertex[];
  return { map, path: { ...path, vertices } };
}

/** Which list of a vector network a member belongs to. */
type NetworkListKey = 'vertices' | 'segments';

/**
 * Looks up a path's network map. The path decoded, so its network is a readable keyed map.
 *
 * @param target - The path.
 * @param key - Which list.
 * @returns The map from member id to `[order, member]`.
 */
function networkOf(target: PathTarget, key: NetworkListKey): Y.Map<unknown> {
  return target.map.get(key) as Y.Map<unknown>;
}

/**
 * Adds or updates a member of a path's network.
 *
 * @param target - The path.
 * @param key - Which list.
 * @param item - The validated member.
 */
function upsertMember(target: PathTarget, key: NetworkListKey, item: NetworkItem): void {
  upsertNetworkItem(networkOf(target, key), item);
}

/**
 * Deletes a member of a path's network by id.
 *
 * @param target - The path.
 * @param key - Which list.
 * @param id - The member id.
 * @returns `true` when a member was deleted.
 */
function deleteMember(target: PathTarget, key: NetworkListKey, id: string): boolean {
  return deleteNetworkItem(networkOf(target, key), id);
}

/**
 * Deletes the stored segments a one-member write collects (`codec/network-collection.ts`), in
 * the caller's transaction.
 *
 * @param target - The path.
 * @param write - What the write does.
 */
function collect(target: PathTarget, write: NetworkWrite): void {
  const segments = networkOf(target, 'segments');
  for (const id of collectedSegments(segments, write)) segments.delete(id);
}

/**
 * Checks that the network after an edit is well formed.
 *
 * @param target - The path.
 * @param vertices - The vertices after the edit.
 * @param segments - The segments after the edit.
 * @throws {DocumentWriteError} When the network would be malformed.
 */
function checkNetwork(
  target: PathTarget,
  vertices: readonly Vertex[],
  segments: readonly Segment[],
): void {
  const messages = findNetworkIssues(vertices, segments);
  if (messages.length > 0) {
    throw new DocumentWriteError(
      target.path.id,
      messages.map((message) => ({ path: ['segments'], message })),
    );
  }
}

/**
 * Replaces the member with an id in a list, or appends it.
 *
 * @param members - The list.
 * @param member - The new member.
 * @returns A new list.
 */
function replaceById<Member extends { readonly id: string }>(
  members: readonly Member[],
  member: Member,
): Member[] {
  const isPresent = members.some((candidate) => candidate.id === member.id);
  return isPresent
    ? members.map((candidate) => (candidate.id === member.id ? member : candidate))
    : [...members, member];
}

/**
 * Adds or updates a vertex.
 *
 * @param target - The path.
 * @param vertex - The vertex.
 * @throws {DocumentWriteError} When the vertex is invalid.
 */
export function setVertex(target: PathTarget, vertex: Vertex): void {
  const parsed = vertexSchema.safeParse(vertex);
  if (!parsed.success) throw new DocumentWriteError(target.path.id, parsed.error.issues);
  checkNetwork(target, replaceById(target.path.vertices, parsed.data), target.path.segments);
  if (!networkOf(target, 'vertices').has(parsed.data.id)) {
    collect(
      target,
      memberWrite(networkOf(target, 'vertices'), { createdVertexIds: new Set([parsed.data.id]) }),
    );
  }
  upsertMember(target, 'vertices', parsed.data);
}

/**
 * Adds or updates a segment.
 *
 * @param target - The path.
 * @param segment - The segment.
 * @throws {DocumentWriteError} When the segment is invalid or the network would be malformed.
 */
export function setSegment(target: PathTarget, segment: Segment): void {
  const parsed = segmentSchema.safeParse(segment);
  if (!parsed.success) throw new DocumentWriteError(target.path.id, parsed.error.issues);
  checkNetwork(target, target.path.vertices, replaceById(target.path.segments, parsed.data));
  upsertMember(target, 'segments', parsed.data);
}

/**
 * Deletes a vertex; the segments a read shows ending at it must already be gone, and the stored
 * segments a read leaves out that end at it go with it.
 *
 * @param target - The path.
 * @param vertexId - The vertex id.
 * @returns `true` when a vertex was deleted.
 * @throws {DocumentWriteError} When a segment still ends at the vertex.
 */
export function deleteVertex(target: PathTarget, vertexId: string): boolean {
  const vertices = target.path.vertices.filter((vertex) => vertex.id !== vertexId);
  checkNetwork(target, vertices, target.path.segments);
  collect(
    target,
    memberWrite(networkOf(target, 'vertices'), { deletedVertexIds: new Set([vertexId]) }),
  );
  return deleteMember(target, 'vertices', vertexId);
}

/**
 * Deletes a segment; when a read showed it, the stored segments joining the same pair go with
 * it, so none shows in its place.
 *
 * @param target - The path.
 * @param segmentId - The segment id.
 * @returns `true` when a segment was deleted.
 */
export function deleteSegment(target: PathTarget, segmentId: string): boolean {
  if (target.path.segments.some(({ id }) => id === segmentId)) {
    collect(
      target,
      memberWrite(networkOf(target, 'vertices'), { deletedSegmentIds: new Set([segmentId]) }),
    );
  }
  return deleteMember(target, 'segments', segmentId);
}

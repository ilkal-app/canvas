import * as Y from 'yjs';

import type { BoardObject } from '@canvas/schema';

import type { DecodeIssue } from './decode-issue.js';
import { readNetworkMap } from './network-codec.js';
import { findNetworkMemberIssues } from './network-well-formed.js';

/**
 * A network map's member count, or `undefined` when the value is not a network map.
 *
 * @param value - The stored value.
 * @returns The count.
 */
function memberCount(value: unknown): number | undefined {
  return value instanceof Y.Map ? (value as Y.Map<unknown>).size : undefined;
}

/**
 * The members of a path's stored network that its decoded value leaves out, as snapshot issues
 * naming the path (`key`), the list (`field`) and the member. A read hides exactly the
 * members that break the network rules (`findNetworkMemberIssues`), so when the decoded path
 * holds as many members as the store, nothing is hidden: that O(1) comparison is all the common
 * case costs. Otherwise the stored network is read again and judged, in O(n log n) of its
 * members.
 *
 * @param key - The entry's key in the object map.
 * @param value - The entry's stored value, which decoded to `object`.
 * @param object - The decoded object.
 * @returns One `hidden-segment` or `stray-vertex` issue per hidden member; empty for any other
 *   object type, or a path that shows every member.
 */
export function hiddenMemberIssues(
  key: string,
  value: unknown,
  object: BoardObject,
): DecodeIssue[] {
  if (object.type !== 'path' || !(value instanceof Y.Map)) return [];
  const map = value as Y.Map<unknown>;
  const storedVertices = map.get('vertices');
  const storedSegments = map.get('segments');
  if (
    memberCount(storedVertices) === object.vertices.length &&
    memberCount(storedSegments) === object.segments.length
  ) {
    return [];
  }
  const vertices = readNetworkMap(storedVertices);
  const segments = readNetworkMap(storedSegments);
  if (typeof vertices === 'string' || typeof segments === 'string') return [];
  return findNetworkMemberIssues({ vertices, segments }).map((issue) => ({
    code: issue.problem === 'stray-vertex' ? 'stray-vertex' : 'hidden-segment',
    key,
    field: issue.list,
    member: issue.id,
    message: `${issue.list}: ${issue.message}`,
  }));
}

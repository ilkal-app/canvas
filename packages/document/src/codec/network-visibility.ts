import * as Y from 'yjs';

import { readNetworkMap } from './network-codec.js';
import {
  findNetworkMemberIssues,
  type NetworkMemberIssue,
  type StoredNetwork,
} from './network-well-formed.js';

export type { StoredNetwork } from './network-well-formed.js';

// A path's vertices and segments are members of keyed maps, so concurrent edits of
// different members merge. Two edits that were each valid where they
// ran can still merge into a network no single edit could write (`findNetworkIssues`,
// `findNetworkMemberIssues`):
// - a segment ending at a vertex another client deleted (one client deletes a vertex while the
//   other drags the handle of a segment ending at it, or splits that segment; an undo restoring
//   a segment whose vertex someone else has since deleted);
// - two segments joining the same pair of vertices (two clients join the same two vertices at
//   once, under different segment ids);
// - a vertex no segment touches any more (two clients delete the two segments at a vertex).
// The rules are applied when a path is READ, never by deleting members: the decoded
// network leaves out a segment whose end is missing, all but the lowest id (UTF-16 order) of the
// segments joining one pair, a segment joining a vertex to itself, and, once the network has a
// segment, every vertex no segment touches. The members stay in the document, so when the
// missing vertex comes back (an undo, a late update) the segment is whole again, whatever order
// the updates arrived in. A write never deletes a member the read left out (`hiddenMembers`),
// except those its own edit makes unable to come back (`network-collection.ts`).
// A path with no segment at all keeps its vertices, so vector editing and the layers panel show
// what is left of it.

/** The ids of the members a read of a network leaves out, per list. */
export interface HiddenMembers {
  /** Vertex ids. */
  readonly vertices: ReadonlySet<unknown>;
  /** Segment ids. */
  readonly segments: ReadonlySet<unknown>;
}

/**
 * The ids of the members named by network issues, per list.
 *
 * @param issues - The issues of a network (`findNetworkMemberIssues`).
 * @returns The ids per list.
 */
function membersOf(issues: readonly NetworkMemberIssue[]): HiddenMembers {
  const idsIn = (list: 'vertices' | 'segments') =>
    new Set<unknown>(issues.filter((issue) => issue.list === list).map(({ id }) => id));
  return { vertices: idsIn('vertices'), segments: idsIn('segments') };
}

/**
 * The network a read shows (see above): the stored network without the members that break the
 * network rules (`findNetworkMemberIssues`, the one definition). Deterministic: every client
 * holding the same document reads the same network. Pure; returns `network` itself when nothing
 * is left out, which is decided in one O(segments) pass; the sort runs only when a rule leaves
 * something out.
 *
 * @param network - The stored network.
 * @returns The network to show.
 */
export function visibleNetwork(network: StoredNetwork): StoredNetwork {
  const issues = findNetworkMemberIssues(network);
  if (issues.length === 0) return network;
  const hidden = membersOf(issues);
  return {
    vertices: network.vertices.filter(({ id }) => !hidden.vertices.has(id)),
    segments: network.segments.filter(({ id }) => !hidden.segments.has(id)),
  };
}

/**
 * The ids of the members of a stored network that a read leaves out.
 *
 * @param network - The stored network.
 * @returns The hidden ids per list; empty when the network is whole.
 */
export function hiddenMembersOf(network: StoredNetwork): HiddenMembers {
  return membersOf(findNetworkMemberIssues(network));
}

/**
 * The members a read of a path's stored map leaves out, which a write of the path must keep.
 *
 * @param map - The path's map, as stored.
 * @returns The hidden ids per list; empty when either list cannot be read.
 */
export function hiddenMembers(map: Y.Map<unknown>): HiddenMembers {
  const vertices = readNetworkMap(map.get('vertices'));
  const segments = readNetworkMap(map.get('segments'));
  if (typeof vertices === 'string' || typeof segments === 'string') {
    return { vertices: new Set(), segments: new Set() };
  }
  return hiddenMembersOf({ vertices, segments });
}

/**
 * Whether writing members to a stored network map would delete any key.
 *
 * @param stored - The stored map, or anything else under the key.
 * @param ids - The ids of the members to write.
 * @returns `true` when the map holds a key `ids` lacks.
 */
export function wouldDeleteMembers(stored: unknown, ids: ReadonlySet<string>): boolean {
  if (!(stored instanceof Y.Map)) return false;
  for (const key of (stored as Y.Map<unknown>).keys()) if (!ids.has(key)) return true;
  return false;
}

import type * as Y from 'yjs';

import { readStoredMember } from './network-codec.js';

// A read leaves out the network members a merge left breaking a rule (`network-visibility.ts`),
// and a write keeps them stored, so an undo or a late update can make them whole again. Some of
// them can never be whole again once the writer's own edit has gone through, so the write deletes
// them in its own transaction (one undo step restores them with the edit), and they neither pile
// up nor keep every later read of the path off its fast path (fix round 2):
// - a segment ending at a vertex the write deletes, when its other end is stored (the vertex's
//   delete would have taken it);
// - a segment ending at a vertex id the write creates: the vertex it once ended at is gone, and a
//   new vertex under the same id (agents choose ids) is not that vertex, so the old segment must
//   not come back joined to it;
// - a stored duplicate of a shown segment the write deletes: two clients joined the same pair,
//   and deleting the one shown must not show the other in its place.
// A segment hidden because its other end is missing stays, even when the write deletes the end
// it still has: it waits for an undo to bring the missing end back. Collecting it loses a
// collaborator's edit of it: Ada deletes v3 while Bob drags s2's handle (s2 hidden), then Ada
// deletes v2; if that delete took s2, undoing it re-creates s2 with Bob's handle as Ada's own
// write, and her next undo (of the v3 delete) then writes her older s2 over it, where without
// the collection Yjs keeps Bob's (`edit-network-collection.sync.test.ts`). Not losing a
// collaborator's work outranks tidiness.

/** What a write does to a path's stored network, by id. */
export interface NetworkWrite {
  /** Vertices the write deletes that a read showed. */
  readonly deletedVertexIds: ReadonlySet<unknown>;
  /** Vertex ids the write creates: not a key of the stored map before it. */
  readonly createdVertexIds: ReadonlySet<unknown>;
  /** Segments the write deletes that a read showed. */
  readonly deletedSegmentIds: ReadonlySet<unknown>;
  /** Segments the write lists (writes them or leaves them as they are): never collected. */
  readonly writtenSegmentIds: ReadonlySet<unknown>;
  /** Vertex ids stored before the write. */
  readonly storedVertexIds: { has(id: string): boolean };
}

/** The two ends of a stored segment. */
interface StoredEnds {
  /** One end's vertex id. */
  readonly a: unknown;
  /** The other end's vertex id. */
  readonly b: unknown;
}

/**
 * The ends of a stored segment.
 *
 * @param value - The value stored under the segment's id.
 * @returns Its ends, or `undefined` when the value is malformed.
 */
function endsOf(value: unknown): StoredEnds | undefined {
  const member = readStoredMember(value)?.[1] as Readonly<Record<string, unknown>> | undefined;
  return member === undefined ? undefined : { a: member.a, b: member.b };
}

/**
 * The pairs of vertices the shown segments a write deletes joined, each end with its partners.
 *
 * @param segments - The stored segment map.
 * @param deleted - The ids of the shown segments the write deletes.
 * @returns Each end with the ends it was joined to.
 */
function deletedPairs(
  segments: Y.Map<unknown>,
  deleted: ReadonlySet<unknown>,
): Map<unknown, unknown[]> {
  const pairs = new Map<unknown, unknown[]>();
  const add = (from: unknown, to: unknown) => pairs.set(from, [...(pairs.get(from) ?? []), to]);
  for (const id of deleted) {
    const ends = endsOf(segments.get(String(id)));
    if (ends === undefined) continue;
    add(ends.a, ends.b);
    add(ends.b, ends.a);
  }
  return pairs;
}

/**
 * The stored segments a write collects (see above): those it does not list that end at a vertex
 * id it creates, at a vertex it deletes while their other end is stored, or join a pair a shown
 * segment it deletes joined. One pass over the stored segments; pure.
 *
 * @param segments - The path's stored segment map, before the write.
 * @param write - What the write does.
 * @returns The ids of the segments to delete in the write's transaction.
 */
export function collectedSegments(segments: Y.Map<unknown>, write: NetworkWrite): Set<string> {
  const pairs = deletedPairs(segments, write.deletedSegmentIds);
  const isStored = (vertexId: unknown) =>
    typeof vertexId === 'string' && write.storedVertexIds.has(vertexId);
  const isDeletedAt = (end: unknown, other: unknown) =>
    write.deletedVertexIds.has(end) && isStored(other);
  const collected = new Set<string>();
  for (const [id, value] of segments.entries()) {
    if (write.writtenSegmentIds.has(id) || write.deletedSegmentIds.has(id)) continue;
    const ends = endsOf(value);
    if (ends === undefined) continue;
    const isCreatedEnd = write.createdVertexIds.has(ends.a) || write.createdVertexIds.has(ends.b);
    const isDeletedEnd = isDeletedAt(ends.a, ends.b) || isDeletedAt(ends.b, ends.a);
    const isDuplicate = pairs.get(ends.a)?.includes(ends.b) === true;
    if (isCreatedEnd || isDeletedEnd || isDuplicate) collected.add(id);
  }
  return collected;
}

/** Nothing: an empty set of ids. */
const NONE: ReadonlySet<unknown> = new Set();

/**
 * A write of one member through the store's per-member edits, as a {@link NetworkWrite}.
 *
 * @param vertices - The path's stored vertex map, before the write.
 * @param change - What the one call does: a vertex deleted or created, or a shown segment
 *   deleted.
 * @returns The write.
 */
export function memberWrite(
  vertices: Y.Map<unknown>,
  change: Partial<Omit<NetworkWrite, 'storedVertexIds'>>,
): NetworkWrite {
  return {
    storedVertexIds: vertices,
    deletedVertexIds: change.deletedVertexIds ?? NONE,
    createdVertexIds: change.createdVertexIds ?? NONE,
    deletedSegmentIds: change.deletedSegmentIds ?? NONE,
    writtenSegmentIds: change.writtenSegmentIds ?? NONE,
  };
}

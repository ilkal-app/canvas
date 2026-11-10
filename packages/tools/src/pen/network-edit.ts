import type { PathNetwork } from '@canvas/engine';
import type { Segment, Vertex } from '@canvas/schema';

/** An `editNetwork` input's member lists: what one gesture changed in a network. */
export interface NetworkEdit {
  /** Vertices added or changed. */
  readonly setVertices: readonly Vertex[];
  /** Vertices removed. */
  readonly deleteVertexIds: readonly string[];
  /** Segments added or changed. */
  readonly setSegments: readonly Segment[];
  /** Segments removed. */
  readonly deleteSegmentIds: readonly string[];
}

/**
 * Whether two members are equal field by field (vertices and segments are flat records of
 * numbers, strings and points).
 *
 * @param first - One member.
 * @param second - The other.
 * @returns True when every field matches.
 */
function isSameMember(first: Vertex | Segment, second: Vertex | Segment): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

/**
 * The members of one list a gesture set and deleted.
 *
 * @param before - The list before.
 * @param after - The list after.
 * @returns The members added or changed, in `after`'s order, and the ids removed.
 */
function diffMembers<Member extends Vertex | Segment>(
  before: readonly Member[],
  after: readonly Member[],
): { readonly set: Member[]; readonly deleted: string[] } {
  const previous = new Map(before.map((member) => [member.id, member]));
  const kept = new Set(after.map(({ id }) => id));
  const set = after.filter((member) => {
    const old = previous.get(member.id);
    return old === undefined || (old !== member && !isSameMember(old, member));
  });
  const deleted = before.filter(({ id }) => !kept.has(id)).map(({ id }) => id);
  return { set, deleted };
}

/**
 * The edit that turns one network into another, member by member: what the gesture's one
 * `editNetwork` writes (only the members a gesture touched are written,
 * so a collaborator's concurrent edits of other members merge). Pure.
 *
 * @param before - The network the gesture started from.
 * @param after - The network it ends with.
 * @returns The members to set and delete.
 */
export function networkEditOf(before: PathNetwork, after: PathNetwork): NetworkEdit {
  const vertices = diffMembers(before.vertices, after.vertices);
  const segments = diffMembers(before.segments, after.segments);
  return {
    setVertices: vertices.set,
    deleteVertexIds: vertices.deleted,
    setSegments: segments.set,
    deleteSegmentIds: segments.deleted,
  };
}

/**
 * Whether an edit changes nothing.
 *
 * @param edit - The edit.
 * @returns True when every list is empty.
 */
export function isEmptyNetworkEdit(edit: NetworkEdit): boolean {
  return (
    edit.setVertices.length === 0 &&
    edit.deleteVertexIds.length === 0 &&
    edit.setSegments.length === 0 &&
    edit.deleteSegmentIds.length === 0
  );
}

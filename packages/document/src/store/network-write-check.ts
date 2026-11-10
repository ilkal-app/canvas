import type { z } from 'zod';

import { isSameValue, segmentSchema, vertexSchema } from '@canvas/schema';

import type { ValidationIssue } from './document-write-error.js';

// The network unit of a field-scoped write (item 1, item 6): a path's `vertices` and
// `segments`, validated member by member. A member the write leaves as stored (by id, the
// door's equality, `isSameValue`) is not judged, and only the network rules a changed member
// takes part in are checked: its own id, its ends, its pair; and, for a vertex the write
// deletes, the segments still ending at it. So an edit of 100 vertices of a 1,000-vertex path
// parses 100 members, not 2,000, and a member a peer left invalid does not block an edit of
// another. The rules are `findNetworkIssues`'s (`@canvas/schema`), with its messages.

/** What the write leaves in the network: the members, parsed where changed, and the problems. */
export interface NetworkWrite {
  /** The problems; empty when the write may go ahead. */
  readonly issues: readonly ValidationIssue[];
  /** The values to write: `vertices` and `segments`, stored members kept as stored. */
  readonly values: Readonly<Record<string, unknown>>;
}

/** A member of a network list as a write may hold it: anything. */
type Member = unknown;

/** What one list of the write changes. */
interface ListWrite {
  /** The members to write: the stored member where unchanged, the parsed member where changed. */
  readonly members: readonly Member[];
  /** The indexes of the changed members. */
  readonly changed: ReadonlySet<number>;
  /** The members' problems. */
  readonly issues: readonly ValidationIssue[];
}

/**
 * Reads a member's id, when it has a string one.
 *
 * @param member - A member.
 * @returns The id, or `undefined`.
 */
function idOf(member: Member): string | undefined {
  if (typeof member !== 'object' || member === null) return undefined;
  const { id } = member as { readonly id?: unknown };
  return typeof id === 'string' ? id : undefined;
}

/**
 * Indexes stored members by id.
 *
 * @param stored - The stored list, as the stored object holds it.
 * @returns The members by id; empty when the list is not an array.
 */
function byId(stored: unknown): ReadonlyMap<string, Member> {
  const members = new Map<string, Member>();
  if (!Array.isArray(stored)) return members;
  for (const member of stored as readonly Member[]) {
    const id = idOf(member);
    if (id !== undefined && !members.has(id)) members.set(id, member);
  }
  return members;
}

/**
 * Validates the members of one list that differ from the stored member with their id.
 *
 * @param key - `vertices` or `segments`.
 * @param written - The list the write holds.
 * @param stored - The list as stored.
 * @param schema - The member schema.
 * @returns The list write.
 */
function checkList(key: string, written: unknown, stored: unknown, schema: z.ZodType): ListWrite {
  if (!Array.isArray(written)) {
    const issues = [{ path: [key], message: `${key} must be a list of members` }];
    return { members: [], changed: new Set(), issues };
  }
  const held = byId(stored);
  const changed = new Set<number>();
  const issues: ValidationIssue[] = [];
  const members = (written as readonly Member[]).map((member, index) => {
    const id = idOf(member);
    const kept = id === undefined ? undefined : held.get(id);
    if (kept !== undefined && isSameValue(member, kept)) return kept;
    changed.add(index);
    const parsed = schema.safeParse(member);
    if (parsed.success) return parsed.data;
    issues.push(
      ...parsed.error.issues.map((issue) => ({ ...issue, path: [key, index, ...issue.path] })),
    );
    return member;
  });
  return { members, changed, issues };
}

/**
 * The keys that appear more than once.
 *
 * @param keys - The keys.
 * @returns Those repeated.
 */
function repeatedKeys(keys: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) repeated.add(key);
    seen.add(key);
  }
  return repeated;
}

/** A segment's ends, as a parsed or stored segment holds them. */
interface Ends {
  readonly id: string;
  readonly a: string;
  readonly b: string;
}

/**
 * The network rules the changed members take part in (`findNetworkIssues`): a changed vertex's
 * id used twice; a changed segment's id used twice, an end that is not a vertex, a vertex joined
 * to itself, a pair joined twice; and a segment, changed or not, ending at a vertex the write
 * deletes. Members of the right shape only (the members' own problems are reported apart).
 *
 * @param vertices - The vertices the write leaves.
 * @param segments - The segments it leaves.
 * @param storedVertexIds - The ids of the stored vertices.
 * @returns The problems.
 */
function networkRuleIssues(
  vertices: ListWrite,
  segments: ListWrite,
  storedVertexIds: ReadonlySet<string>,
): ValidationIssue[] {
  // Every member has its string id here: changed ones parsed, kept ones matched by it.
  const vertexIds = (vertices.members as readonly { readonly id: string }[]).map(({ id }) => id);
  const heldIds = new Set(vertexIds);
  const repeatedVertexIds = repeatedKeys(vertexIds);
  const issues: ValidationIssue[] = [];
  vertexIds.forEach((id, index) => {
    if (vertices.changed.has(index) && repeatedVertexIds.has(id)) {
      issues.push({ path: ['vertices', index], message: `vertex id "${id}" is used twice` });
    }
  });
  const ends = segments.members as readonly Ends[];
  const repeatedSegmentIds = repeatedKeys(ends.map(({ id }) => id));
  const pairOf = ({ a, b }: Ends): string => JSON.stringify([a, b].sort());
  const repeatedPairs = repeatedKeys(ends.map(pairOf));
  ends.forEach((segment, index) => {
    const isChanged = segments.changed.has(index);
    const path = ['segments', index];
    for (const end of [segment.a, segment.b]) {
      if (heldIds.has(end) || !(isChanged || storedVertexIds.has(end))) continue;
      issues.push({ path, message: `segment "${segment.id}" ends at missing vertex "${end}"` });
    }
    if (!isChanged) return;
    if (repeatedSegmentIds.has(segment.id)) {
      issues.push({ path, message: `segment id "${segment.id}" is used twice` });
    }
    if (segment.a === segment.b) {
      issues.push({
        path,
        message: `segment "${segment.id}" joins vertex "${segment.a}" to itself`,
      });
    }
    if (repeatedPairs.has(pairOf(segment))) {
      const message = `segment "${segment.id}" joins "${segment.a}" and "${segment.b}", which are already joined`;
      issues.push({ path, message });
    }
  });
  return issues;
}

/**
 * Validates a write of a path's network against the network it holds, member by member:
 * the changed members against `vertexSchema` and `segmentSchema`, and the network
 * rules they take part in. Pure; O(the network) in lookups, O(the changed members) in parsing.
 *
 * @param written - The object as the write would leave it (`vertices`, `segments`).
 * @param stored - The object as stored.
 * @returns The members to write and the problems.
 */
export function checkNetworkWrite(
  written: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>,
): NetworkWrite {
  const vertices = checkList('vertices', written.vertices, stored.vertices, vertexSchema);
  const segments = checkList('segments', written.segments, stored.segments, segmentSchema);
  const values = { vertices: vertices.members, segments: segments.members };
  const memberIssues = [...vertices.issues, ...segments.issues];
  if (memberIssues.length > 0) return { issues: memberIssues, values };
  const storedVertexIds = new Set(byId(stored.vertices).keys());
  return { issues: networkRuleIssues(vertices, segments, storedVertexIds), values };
}

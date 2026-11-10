// What a well-formed vector network is, in one place. A path's vertices and
// segments are members of keyed maps, so concurrent edits, and undos, can merge into
// a network no single edit could write. This module names the members that break the
// rules; the reader hides exactly those (`network-visibility.ts`) and reports them in
// `BoardSnapshot#issues` (`hidden-member-issues.ts`), and the sync fuzz fails a decoded path
// for which it names anything.

import { describeId, describeValue } from './describe-value.js';

/** A stored member of a network (a vertex or a segment): trusted, not validated. */
export type StoredNetworkMember = Readonly<Record<string, unknown>>;

/** A network as stored, or as decoded: its vertices and segments, in their stored order. */
export interface StoredNetwork {
  /** The vertices (`id`, position, mirror). */
  readonly vertices: readonly StoredNetworkMember[];
  /** The segments (`id`, ends `a` and `b`, handle offsets `ha` and `hb`). */
  readonly segments: readonly StoredNetworkMember[];
}

/**
 * Why a member breaks the network rules: a segment ends at a vertex the network does not hold
 * (`missing-vertex`), joins a vertex to itself (`joins-itself`), or joins a pair of vertices a
 * segment of lower id already joins (`duplicate-pair`); or, once the network shows a segment, a
 * vertex is on none of the segments shown (`stray-vertex`).
 */
export const NETWORK_MEMBER_PROBLEMS = [
  'missing-vertex',
  'joins-itself',
  'duplicate-pair',
  'stray-vertex',
] as const;

/** One of {@link NETWORK_MEMBER_PROBLEMS}. */
export type NetworkMemberProblem = (typeof NETWORK_MEMBER_PROBLEMS)[number];

/** A member that breaks the network rules, and why. */
export interface NetworkMemberIssue {
  /** Which list the member is in. */
  readonly list: 'vertices' | 'segments';
  /** The member's id. */
  readonly id: string;
  /** What is wrong with it. */
  readonly problem: NetworkMemberProblem;
  /**
   * The other member involved: the missing vertex, the vertex joined to itself, or the segment
   * that already joins the pair; `null` for a stray vertex.
   */
  readonly relatedId: string | null;
  /** A human-readable description. */
  readonly message: string;
}

/**
 * A member's id as text. The reader only shows members whose id is the key of their map entry,
 * so it is a string; anything else (a network built by hand) is described, not converted.
 *
 * @param member - The member.
 * @returns Its id.
 */
function idOf(member: StoredNetworkMember): string {
  return describeId(member.id);
}

/**
 * Each vertex id with what segments already join it to, flattened as neighbour id then segment
 * id, so recording a join allocates nothing.
 */
type Joins = Map<unknown, unknown[]>;

/**
 * An empty record of joins over a network's vertices.
 *
 * @param vertices - The vertices.
 * @returns Each vertex id with no neighbours yet.
 */
function joinsOf(vertices: readonly StoredNetworkMember[]): Joins {
  return new Map(vertices.map(({ id }) => [id, []]));
}

/**
 * The segment that joins a vertex to another, looked up in a list of the vertex's joins.
 *
 * @param joins - The vertex's joins: neighbour id, then segment id, per join.
 * @param other - The other vertex.
 * @returns The joining segment's id, or `undefined`.
 */
function joiningSegment(joins: readonly unknown[], other: unknown): string | undefined {
  for (let index = 0; index < joins.length; index += 2) {
    if (joins[index] === other) return joins[index + 1] as string;
  }
  return undefined;
}

/**
 * Checks a segment against the joins recorded so far, and records its join when it keeps the
 * rules. A pair is looked up at the end with fewer joins, so a pass stays near O(segments).
 *
 * @param joins - The joins so far; updated when the segment keeps the rules.
 * @param segment - The segment.
 * @returns The segment's issue, or `null` when it keeps the rules (and was recorded).
 */
function checkSegment(joins: Joins, segment: StoredNetworkMember): NetworkMemberIssue | null {
  const { a, b } = segment;
  const id = idOf(segment);
  const atA = joins.get(a);
  const atB = joins.get(b);
  // The ends are whatever a peer stored (a bigint, an object, a very long string): they are
  // described for the message, never converted with `String` or `JSON.stringify`.
  const issue = (problem: NetworkMemberProblem, relatedId: unknown, message: string) => ({
    list: 'segments' as const,
    id,
    problem,
    relatedId: describeId(relatedId),
    message,
  });
  const missing = atA === undefined ? a : atB === undefined ? b : undefined;
  if (atA === undefined || atB === undefined) {
    const message = `segment ${describeValue(id)} ends at missing vertex ${describeValue(missing)}`;
    return issue('missing-vertex', missing, message);
  }
  if (a === b) {
    const message = `segment ${describeValue(id)} joins vertex ${describeValue(a)} to itself`;
    return issue('joins-itself', a, message);
  }
  const joined = atA.length <= atB.length ? joiningSegment(atA, b) : joiningSegment(atB, a);
  if (joined !== undefined) {
    const pair = `${describeValue(a)} and ${describeValue(b)}`;
    const message = `segment ${describeValue(id)} joins ${pair}, which segment ${describeValue(joined)} already joins`;
    return issue('duplicate-pair', joined, message);
  }
  atA.push(b, id);
  atB.push(a, id);
  return null;
}

/**
 * Whether a network keeps every rule, in one pass over the segments with no sort: the common
 * case, checked on every decode of a path.
 *
 * @param network - The network.
 * @returns `true` when no member breaks a rule.
 */
function isWellFormed(network: StoredNetwork): boolean {
  const joins = joinsOf(network.vertices);
  let touched = 0;
  for (const segment of network.segments) {
    const isNewA = joins.get(segment.a)?.length === 0;
    const isNewB = joins.get(segment.b)?.length === 0;
    if (checkSegment(joins, segment) !== null) return false;
    touched += Number(isNewA) + Number(isNewB);
  }
  return network.segments.length === 0 || touched === joins.size;
}

/**
 * Compares two members by id in UTF-16 order. Ids are keys of one map, so never equal.
 *
 * @param first - One member.
 * @param second - The other.
 * @returns Negative when `first` comes first, else positive.
 */
function byId(first: StoredNetworkMember, second: StoredNetworkMember): number {
  return idOf(first) < idOf(second) ? -1 : 1;
}

/**
 * The members of a network that break the network rules: the one definition of a well-formed
 * network, which the reader, `BoardSnapshot#issues` and the sync fuzz share. A network is well
 * formed when this is empty. Segments are judged in id order, so of the segments joining one
 * pair the lowest id keeps the rules; a vertex is stray only when some segment keeps them (a
 * network with no such segment shows all its vertices, so vector editing can still reach them).
 * Handles are offsets stored on their segment, so a handle cannot outlive its segment. Members
 * a map cannot hold twice (two with one id) or cannot read at all are the codec's to report.
 * Deterministic whatever the stored order; pure. Cost: one pass with no sort when the network is
 * well formed, else a sort of the members, O(n log n).
 *
 * @param network - The network, as stored or as decoded.
 * @returns Segments then vertices, each by id; empty when the network is well formed.
 */
export function findNetworkMemberIssues(network: StoredNetwork): NetworkMemberIssue[] {
  if (isWellFormed(network)) return [];
  const joins = joinsOf(network.vertices);
  const issues: NetworkMemberIssue[] = [];
  const touched = new Set<unknown>();
  for (const segment of [...network.segments].sort(byId)) {
    const issue = checkSegment(joins, segment);
    if (issue === null) touched.add(segment.a).add(segment.b);
    else issues.push(issue);
  }
  if (touched.size === 0) return issues;
  for (const vertex of [...network.vertices].sort(byId)) {
    if (touched.has(vertex.id)) continue;
    const id = idOf(vertex);
    const message = `vertex ${describeValue(id)} is on no segment`;
    issues.push({ list: 'vertices', id, problem: 'stray-vertex', relatedId: null, message });
  }
  return issues;
}

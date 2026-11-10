/**
 * What a snapshot could not show. The first five say why an entry of the document's object map
 * could not be read as a board object, which the snapshot then leaves out: it is not a `Y.Map`,
 * its `type` is unknown (a newer schema, or a faulty peer), a field is missing, a field's shared
 * type is wrong, or the stored `id` is not the entry's key. The next two name one member of a
 * path's vector network that the read hid while showing the path (
 * `findNetworkMemberIssues`): a segment that ends at a missing vertex, joins a vertex to itself
 * or duplicates a pair (`hidden-segment`), or a vertex on no segment (`stray-vertex`, the milder:
 * nothing drawn is wrong, the vertex is only unseen). The last names an object on a stored parent
 * cycle that the read shows at the root, as the repair will write it (`parent-cycle`;
 * field `parentId`): until the repair has run, or where it cannot write.
 */
export const DECODE_ISSUE_CODES = [
  'not-a-map',
  'unknown-type',
  'missing-field',
  'malformed-field',
  'id-mismatch',
  'hidden-segment',
  'stray-vertex',
  'parent-cycle',
] as const;

/** One of {@link DECODE_ISSUE_CODES}. */
export type DecodeIssueCode = (typeof DECODE_ISSUE_CODES)[number];

/**
 * An entry of the object map that the snapshot leaves out, or a member of a path's network that
 * it hides, or a stored parent cycle it shows broken, and why. Remote updates are not validated per object (see the README), so the
 * snapshot reports what it cannot read or show instead of throwing.
 */
export interface DecodeIssue {
  /** What kind of problem this is. */
  readonly code: DecodeIssueCode;
  /** The entry's key in the object map, which is the object id when the entry is well formed. */
  readonly key: string;
  /** The field at fault, or `null` when the whole entry is. */
  readonly field: string | null;
  /** The hidden network member's id (`vertices` or `segments` in `field`); only on those issues. */
  readonly member?: string;
  /** A human-readable description. */
  readonly message: string;
}

/**
 * Why one field (or group of fields) of a stored object could not be read; the codec turns it
 * into a {@link DecodeIssue}. Package-internal.
 */
export interface FieldProblem {
  /** The field, or group, at fault. */
  readonly field: string;
  /** A description. */
  readonly message: string;
  /** Whether the field is missing, rather than malformed. */
  readonly isMissing: boolean;
}

/**
 * Whether an issue names a network member a read hid from an object it shows, rather than an
 * entry it could not read.
 *
 * @param issue - The issue.
 * @returns `true` for `hidden-segment` and `stray-vertex`.
 */
export function isHiddenMemberIssue(issue: DecodeIssue): boolean {
  return issue.code === 'hidden-segment' || issue.code === 'stray-vertex';
}

/**
 * Whether an issue names a stored parent cycle shown broken in the readable view.
 *
 * @param issue - The snapshot issue.
 * @returns `true` for `parent-cycle`; it does not mean the object is unreadable.
 */
export function isParentCycleIssue(issue: DecodeIssue): boolean {
  return issue.code === 'parent-cycle';
}

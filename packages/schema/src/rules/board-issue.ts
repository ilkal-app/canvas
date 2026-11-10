/**
 * The kinds of problem an imported or validated board can have. The first six come only from
 * `importBoard` (the file itself is malformed): `run-splits-character` is an object whose style
 * run starts inside a surrogate pair (`findRunsSplittingCharacters`), split out of
 * `invalid-object` so a caller can repair it by moving the boundary, and `invalid-z-key` an
 * object whose `z` breaks the fractional-index key rule (`isValidKey`), and `out-of-bound` an
 * object whose box on the board is past the board's bound, or that holds a value past its limit
 * or a number that is not finite, so a paste can say why it took nothing. The rest are
 * the reference rules of `validateBoard`, the page rules last:
 * `missing-page` (a root object names no live page), `invalid-page` (an object
 * in a group or frame names a page), `cross-page` (a connector end or comment anchor on an
 * object of another page) and `page-count` (more live pages than `MAX_PAGES`, a notice); then
 * the instance codes, and `unknown-color-token` (a notice: a colour names a token the
 * board does not have, so it draws as ink; `relatedId` is the token's id), `unknown-text-style`
 * and `unknown-effect-style` (notices: an object names a style the board does not have;
 * its stored values still draw), and `duplicate-style-name` (an imported style table names two
 * styles of a kind alike, ignoring case).
 */
export const BOARD_ISSUE_CODES = [
  'invalid-format',
  'unsupported-schema-version',
  'invalid-object',
  'run-splits-character',
  'invalid-z-key',
  'out-of-bound',
  'duplicate-id',
  'id-mismatch',
  'missing-parent',
  'invalid-parent',
  'parent-cycle',
  'missing-connector-target',
  'invalid-connector-target',
  'missing-comment-anchor',
  'invalid-comment-anchor',
  'missing-page',
  'invalid-page',
  'cross-page',
  'page-count',
  'missing-main',
  'invalid-main',
  'instance-cycle',
  'instance-depth',
  'unknown-color-token',
  'unknown-text-style',
  'unknown-effect-style',
  'duplicate-style-name',
] as const;

/** One of {@link BOARD_ISSUE_CODES}. */
export type BoardIssueCode = (typeof BOARD_ISSUE_CODES)[number];

/**
 * A problem found in a board, structured so the command layer and agents can act on it without
 * parsing the message.
 */
export interface BoardIssue {
  /** What kind of problem this is. */
  readonly code: BoardIssueCode;
  /** The object with the problem, or `null` when the problem is not about one object. */
  readonly objectId: string | null;
  /** The other object the problem involves (a missing parent, a connector target), or `null`. */
  readonly relatedId: string | null;
  /** The path of the offending field within the object (or the file), e.g. `['from', 'objectId']`. */
  readonly path: readonly (string | number)[];
  /** A human-readable description of the problem. */
  readonly message: string;
  /**
   * `'notice'` for a state the board may legitimately reach and keeps (`page-count`: concurrent
   * page adds past `MAX_PAGES`; `unknown-color-token`: an object naming a deleted token;
   * `unknown-text-style` and `unknown-effect-style`: an object naming a
   * deleted style); absent for an error.
   */
  readonly severity?: 'notice';
}

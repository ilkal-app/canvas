import type { ObjectId } from '@canvas/schema';

import type { ValidationIssue } from '../store/document-write-error.js';

/**
 * Why a command was rejected. The command layer's own codes come first; the rest are the
 * reference rules of the schema's `validateBoard`, reported under the
 * same codes so an agent handles a rejected command and an invalid board alike.
 *
 * - `invalid-input`: the input does not match the command's input schema.
 * - `missing-object`: an id names no readable object on the board.
 * - `duplicate-id`: an id is listed twice, or a new object's id is already in use.
 * - `locked`: the object is locked, and the command would move or resize it.
 * - `unsupported-type`: the object's type does not take this command or field (resizing a
 *   line, ungrouping a shape, a `fill` on a sticky, text on an image).
 * - `mixed-parents`: objects to group do not share one parent.
 * - `overlapping-selection`: an object is listed together with one of its ancestors.
 * - `invalid-object`: the object the command would write fails the schema.
 * - `unorderable-neighbours`: a reorder cannot place objects between their new neighbours,
 *   whose keys are not fractional-index keys or are equal (a board imported with such keys).
 * - `key-too-long`: a reorder's new key would exceed `MAX_KEY_LENGTH` (the README's growth
 *   bound: thousands of consecutive moves into one gap).
 * - `missing-page`: a page id names no live page; also a root object
 *   placed on one.
 * - `last-page`: deleting the only page left.
 * - `too-many-pages`: adding or duplicating a page on a board of `MAX_PAGES` or more pages.
 * - `unknown-variant`: a variant axis or value the main does not have: a selection, a
 *   preset or a rename naming one, or a selection on a main without variants.
 * - `cross-page`: a reference across pages: a connector end or comment pin on an object of
 *   another page, or a reparent into a frame on another page.
 * - `missing-token`: a colour token id names no custom token of the board.
 * - `builtin-token`: renaming or deleting a built-in colour token (their values are editable,
 *   `resetColorToken` restores them).
 * - `not-own-token`: an agent editing, renaming, deleting or resetting a token it did not
 *   create, or any built-in.
 * - `too-many-tokens`: creating a custom token on a board of `MAX_CUSTOM_TOKENS` or more.
 * - `duplicate-token-name`: a token name the board already uses (names compare case-blind).
 * - `missing-style`: a named text or effect style id the board lacks.
 * - `not-own-style`: an agent changing or deleting a named style it did not create.
 * - `too-many-styles`: creating a style of a kind on a board of that kind's limit (64).
 * - `duplicate-style-name`: a style name another style of the kind uses (case-blind).
 */
export const COMMAND_ERROR_CODES = [
  'missing-main',
  'invalid-main',
  'retired-main',
  'instance-cycle',
  'instance-depth',
  'too-many-instances',
  'invalid-override',
  'invalid-override-path',
  'ambiguous-override-path',
  'not-own-main',
  'not-own-object',
  'unknown-variant',
  'invalid-input',
  'missing-object',
  'duplicate-id',
  'locked',
  'unsupported-type',
  'mixed-parents',
  'overlapping-selection',
  'invalid-object',
  'unorderable-neighbours',
  'key-too-long',
  'missing-page',
  'last-page',
  'too-many-pages',
  'cross-page',
  'missing-token',
  'builtin-token',
  'not-own-token',
  'too-many-tokens',
  'duplicate-token-name',
  'missing-style',
  'not-own-style',
  'too-many-styles',
  'duplicate-style-name',
  'missing-parent',
  'invalid-parent',
  'parent-cycle',
  'missing-connector-target',
  'invalid-connector-target',
  'missing-comment-anchor',
  'invalid-comment-anchor',
] as const;

/** One of {@link COMMAND_ERROR_CODES}. */
export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

/**
 * Tells whether a code is one of {@link COMMAND_ERROR_CODES}.
 *
 * @param code - A code, such as a schema `BoardIssueCode`.
 * @returns `true` when commands report problems under this code.
 */
export function isCommandErrorCode(code: string): code is CommandErrorCode {
  return (COMMAND_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * One reason a command was rejected, structured so an agent can act on it without parsing the
 * message. A rejected command wrote nothing.
 */
export interface CommandError {
  /** What kind of problem this is. */
  readonly code: CommandErrorCode;
  /** The object the problem is about, or `null` when it is about the input as a whole. */
  readonly objectId: string | null;
  /**
   * Where the problem is. For `invalid-input`, the path into the command's input; for
   * `invalid-object` and the reference codes, the path of the field within the object
   * `objectId` would become; otherwise the path into the input of the entry naming the object.
   */
  readonly path: readonly (string | number)[];
  /** A human-readable description of the problem. */
  readonly message: string;
}

/**
 * Builds a command error.
 *
 * @param code - What kind of problem.
 * @param objectId - The object it is about, or `null`.
 * @param path - Where it is (see {@link CommandError.path}).
 * @param message - The description.
 * @returns The error, frozen.
 */
export function commandError(
  code: CommandErrorCode,
  objectId: ObjectId | string | null,
  path: readonly (string | number)[],
  message: string,
): CommandError {
  return Object.freeze({ code, objectId, path: Object.freeze([...path]), message });
}

/**
 * Converts schema validation issues (from the command's input schema, or from validating an
 * object it would write) into command errors.
 *
 * @param code - `invalid-input` or `invalid-object`.
 * @param objectId - The object the issues are about, or `null` for the input.
 * @param issues - The validation issues.
 * @returns One command error per issue.
 */
export function errorsFromIssues(
  code: 'invalid-input' | 'invalid-object',
  objectId: string | null,
  issues: readonly ValidationIssue[],
): CommandError[] {
  return issues.map((issue) =>
    commandError(
      code,
      objectId,
      issue.path.map((key) => (typeof key === 'number' ? key : String(key))),
      issue.message,
    ),
  );
}

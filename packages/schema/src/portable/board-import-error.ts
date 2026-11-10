import type { BoardIssue } from '../rules/board-issue.js';

/**
 * Thrown by `importBoard` when a document cannot become a board. It carries every issue found,
 * structured, so a caller (or an agent) can report or repair them without parsing the message.
 */
export class BoardImportError extends Error {
  /** Every problem found, in document order; never empty. */
  readonly issues: readonly BoardIssue[];

  /**
   * Creates the error from the issues that caused it.
   *
   * @param issues - The problems found; at least one.
   */
  constructor(issues: readonly BoardIssue[]) {
    const first = issues[0]?.message ?? 'unknown problem';
    const more = issues.length > 1 ? ` (and ${String(issues.length - 1)} more)` : '';
    super(`The board could not be imported: ${first}${more}`);
    this.name = 'BoardImportError';
    this.issues = issues;
  }
}

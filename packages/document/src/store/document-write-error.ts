import type { BoardIssue, ObjectId } from '@canvas/schema';

/** The shape of a schema validation issue that the store reports. */
export interface ValidationIssue {
  /** The path of the offending field. */
  readonly path: readonly PropertyKey[];
  /** What is wrong. */
  readonly message: string;
}

/**
 * Thrown by a transaction's write when the value it would write does not pass the schema. It
 * carries the problems as the schema's `BoardIssue`s (`invalid-object`), so the command layer
 * can hand them to an agent without parsing the message. The failing call wrote nothing, but
 * earlier writes in the same transaction stay and are committed and broadcast when it ends
 * (Yjs has no rollback); the command layer validates a whole command first.
 */
export class DocumentWriteError extends Error {
  /** Every problem found; never empty. */
  readonly issues: readonly BoardIssue[];

  /**
   * Creates the error from schema validation issues.
   *
   * @param objectId - The object the write was for.
   * @param issues - The validation issues; at least one.
   */
  constructor(objectId: ObjectId | string, issues: readonly ValidationIssue[]) {
    const boardIssues = issues.map((issue): BoardIssue => ({
      code: 'invalid-object',
      objectId,
      relatedId: null,
      path: issue.path.map((key) => (typeof key === 'number' ? key : String(key))),
      message: issue.message,
    }));
    const first = boardIssues[0];
    const where =
      first === undefined || first.path.length === 0 ? '' : ` at ${first.path.join('.')}`;
    super(`Invalid write to "${objectId}"${where}: ${first?.message ?? 'unknown problem'}`);
    this.name = 'DocumentWriteError';
    this.issues = boardIssues;
  }
}

import { describeJson } from '../codec/describe-value.js';

/** Why a document cannot be read by this build. */
export type DocumentVersionProblem = 'unversioned' | 'unreadable-version';

/**
 * Names the writers in the error's message: `by client 7 ` or `by clients 7, 9 `, or nothing.
 *
 * @param writers - The unstamped writers' Yjs client ids.
 * @returns The clause, ending in a space, or an empty string when there are none.
 */
function unstampedWritersClause(writers: readonly number[]): string {
  if (writers.length === 0) return '';
  const sorted = [...writers].sort((first, second) => first - second).join(', ');
  return writers.length === 1 ? `by client ${sorted} ` : `by clients ${sorted} `;
}

/**
 * Thrown by `YjsDocumentStore#applyUpdate` when the document it now holds was written in a
 * layout or schema this build cannot read: objects created by a writer that left no metadata
 * stamp (a board saved before, in the per-field layout of or the first grouped
 * layout of, or a build from before still editing a newer board), or
 * metadata naming a layout or schema version this build does not read (a newer peer). The
 * store refuses every later write; the caller discards it. Boards written before exist
 * only on developer machines; serving them, or older clients, is the relay's version gate.
 */
export class DocumentVersionError extends Error {
  /** What is wrong with the document's version. */
  readonly problem: DocumentVersionProblem;
  /** The metadata the document holds, or `undefined` when it has none. */
  readonly stored: unknown;
  /**
   * For `unversioned`: the Yjs client ids of every writer whose objects the update brought
   * without a stamp, ascending; empty when not known.
   */
  readonly writers: readonly number[];

  /**
   * Creates the error.
   *
   * @param problem - What is wrong.
   * @param stored - The stored metadata, if any.
   * @param writers - For `unversioned`, the unstamped writers' Yjs client ids.
   */
  constructor(problem: DocumentVersionProblem, stored: unknown, writers: readonly number[] = []) {
    super(
      problem === 'unversioned'
        ? `This board holds objects written ${unstampedWritersClause(writers)}without a layout ` +
            'version, as every build before layout versions wrote them, and cannot be read; ' +
            "boards and builds from before layout versions are not migrated (see the relay's " +
            'layout version gate). Delete the local board and its cache, and update the other ' +
            'client.'
        : `This board was written in a layout or schema this build cannot read ` +
            `(${describeJson(stored)}); the relay's layout version gate keeps ` +
            'clients and boards of different layouts apart.',
    );
    this.name = 'DocumentVersionError';
    this.problem = problem;
    this.stored = stored;
    this.writers = Object.freeze([...writers].sort((first, second) => first - second));
  }
}

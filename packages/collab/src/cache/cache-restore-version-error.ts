import { DocumentVersionError } from '@canvas/document';

/** A cache-only refusal: the supplied live store passed before cached records were staged. */
export class CacheRestoreVersionError extends DocumentVersionError {
  /**
   * Preserves the strict guard's refusal while identifying the isolated cache source.
   *
   * @param error - The unchanged layout refusal.
   */
  constructor(error: DocumentVersionError) {
    super(error.problem, error.stored, error.writers);
  }
}

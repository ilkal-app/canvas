import { DocumentVersionError } from '@canvas/document';

/**
 * Finds the `DocumentVersionError` in what applying a relayed update threw: the error itself,
 * or one of an `AggregateError`'s (a listener failed too).
 *
 * @param error - What was thrown.
 * @returns The version error, or undefined.
 */
export function versionErrorIn(error: unknown): DocumentVersionError | undefined {
  if (error instanceof DocumentVersionError) return error;
  const inner: readonly unknown[] = error instanceof AggregateError ? error.errors : [];
  for (const each of inner) {
    const found = versionErrorIn(each);
    if (found !== undefined) return found;
  }
  return undefined;
}

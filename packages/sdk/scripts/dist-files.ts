// Which of dist/'s files the SDK's package carries. Pure: prune-dist.ts removes the
// test declarations, and package.json's `files` leaves out the rest.

/**
 * Whether a file of dist/ declares a test (`*.test.d.ts` and its map).
 *
 * @param file - Its path in dist/.
 * @returns True for one.
 */
export function isTestDeclaration(file: string): boolean {
  return /\.test\.d\.ts(?:\.map)?$/u.test(file);
}

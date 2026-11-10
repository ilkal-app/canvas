/**
 * Tells whether a UTF-16 code unit is the first half of a surrogate pair.
 *
 * @param code - The code unit.
 * @returns `true` for 0xD800 to 0xDBFF.
 */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Tells whether a UTF-16 code unit is the second half of a surrogate pair.
 *
 * @param code - The code unit.
 * @returns `true` for 0xDC00 to 0xDFFF.
 */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** How much two strings share at their ends. */
export interface CommonEnds {
  /** Code units both strings start with. */
  readonly prefix: number;
  /** Code units both strings end with, not overlapping the prefix in either string. */
  readonly suffix: number;
}

/**
 * Measures the common prefix and suffix of two strings in UTF-16 code units, never cutting a
 * surrogate pair: Yjs replaces half a pair with U+FFFD when an edit splits one, so an edit
 * boundary inside a pair would corrupt the character.
 *
 * @param before - The current string.
 * @param after - The new string.
 * @returns The prefix and suffix lengths; `before.slice(prefix, before.length - suffix)` is
 *   what changed.
 */
export function findCommonEnds(before: string, after: string): CommonEnds {
  const shorter = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < shorter && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  if (prefix > 0 && prefix < shorter && isHighSurrogate(before.charCodeAt(prefix - 1))) {
    prefix -= 1;
  }
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && isLowSurrogate(before.charCodeAt(before.length - suffix))) suffix -= 1;
  return { prefix, suffix };
}

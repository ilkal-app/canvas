// The rule for fractional-index keys, the `z` field of every object (z-order
// is a fractional index, never array position). The scheme is David Greenspan's
// "Implementing Fractional Indexing" (observablehq.com/@dgreensp/implementing-fractional-indexing),
// the one behind Figma's z-order and the `fractional-indexing` package, as adopted it in
// `@canvas/document` (`src/z-order/`), which generates keys. The rule lives here so the schema,
// the document and the engine all accept the same keys.

/**
 * The base-62 digits of a key, in ascending code-unit order (`0`–`9`, `A`–`Z`, `a`–`z`), so
 * that comparing keys as strings compares them as numbers.
 */
export const BASE_62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * The longest valid key, in characters. The keys `@canvas/document` writes stay a few
 * characters long; only a run of more than 2,525 worst-case moves into one gap reaches it (the
 * growth bound in the document package's README).
 */
export const MAX_KEY_LENGTH = 512;

/** The smallest integer part, `A` and 26 zeros: nothing sorts below it, so alone it is not a key. */
export const SMALLEST_KEY_INTEGER = `A${BASE_62_DIGITS.charAt(0).repeat(26)}`;

/** Every key is one or more base-62 digits. Package-private: `zKeySchema` states it for agents. */
export const KEY_CHARACTERS = /^[0-9A-Za-z]+$/;

/**
 * The length of a key's integer part from its head letter: `a`–`z` head 1 to 26 digits (the
 * non-negative integers, `a0` is zero), `Z`–`A` head 1 to 26 digits (the negative ones).
 *
 * @param head - The first character of a key.
 * @returns The length of the integer part including the head, or `undefined` when the head is
 *   not a letter.
 */
export function keyIntegerLength(head: string): number | undefined {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  return undefined;
}

/**
 * Whether a string has the shape of a key, whatever its length: base-62 characters, a head
 * letter followed by at least as many digits as it states, a fraction that does not end in `0`
 * (there is no key between `x` and `x0`), and not {@link SMALLEST_KEY_INTEGER} alone. Key
 * generation accepts bounds of any length, so it checks this; stored keys are checked with
 * {@link isValidKey}. Pure.
 *
 * @param key - The candidate.
 * @returns `true` when `key` is well formed.
 */
export function isWellFormedKey(key: string): boolean {
  if (!KEY_CHARACTERS.test(key)) return false;
  const length = keyIntegerLength(key.charAt(0));
  if (length === undefined || key.length < length || key === SMALLEST_KEY_INTEGER) return false;
  return key.length === length || !key.endsWith(BASE_62_DIGITS.charAt(0));
}

/**
 * Whether a string is a fractional-index key, the rule for every stored `z`: a well-formed key
 * ({@link isWellFormedKey}) of 1 to {@link MAX_KEY_LENGTH} characters. Pure.
 *
 * @param key - The candidate.
 * @returns `true` when `key` is a valid key.
 */
export function isValidKey(key: string): boolean {
  return key.length <= MAX_KEY_LENGTH && isWellFormedKey(key);
}

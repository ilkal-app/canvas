import { BASE_62_DIGITS, keyIntegerLength } from '@canvas/schema';

// Arithmetic on the integer part of a fractional-index key: a head letter that states the
// length, then base-62 digits. The scheme is David Greenspan's "Implementing Fractional
// Indexing" (observablehq.com/@dgreensp/implementing-fractional-indexing), the one behind
// Figma's z-order and the `fractional-indexing` package. The key rule
// itself (alphabet, head lengths, the smallest integer, the length cap) is the schema's
// (`@canvas/schema`, `z-order/key-rule.ts`), shared with the engine.

/** The zero digit, which may not end a key's fraction. */
export const ZERO_DIGIT = BASE_62_DIGITS.charAt(0);

/**
 * The integer part of a key whose head is known to be a letter.
 *
 * @param key - A valid key.
 * @returns The head and its digits.
 */
export function integerPart(key: string): string {
  return key.slice(0, keyIntegerLength(key.charAt(0)));
}

/**
 * The digit values of an integer part, after its head.
 *
 * @param integer - A valid integer part.
 * @returns The values, 0 to 61, most significant first.
 */
function digitValues(integer: string): number[] {
  const values: number[] = [];
  for (let index = 1; index < integer.length; index += 1) {
    values.push(BASE_62_DIGITS.indexOf(integer.charAt(index)));
  }
  return values;
}

/**
 * Writes digit values as base-62 text.
 *
 * @param values - The values, 0 to 61.
 * @returns The digits.
 */
function digitText(values: readonly number[]): string {
  return values.map((value) => BASE_62_DIGITS.charAt(value)).join('');
}

/**
 * Adds one to an integer part, moving to the next head (one digit longer for the
 * non-negative heads, one shorter for the negative ones) when the digits overflow.
 *
 * @param integer - A valid integer part.
 * @returns The next integer part, or `undefined` after the largest (`z` and 26 `z` digits).
 */
export function incrementInteger(integer: string): string | undefined {
  const head = integer.charAt(0);
  const digits = digitValues(integer);
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const next = (digits[index] ?? 0) + 1;
    if (next < BASE_62_DIGITS.length) {
      digits[index] = next;
      return head + digitText(digits);
    }
    digits[index] = 0;
  }
  if (head === 'Z') return `a${ZERO_DIGIT}`;
  if (head === 'z') return undefined;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push(0);
  else digits.pop();
  return nextHead + digitText(digits);
}

/**
 * Subtracts one from an integer part, moving to the previous head when the digits underflow.
 *
 * @param integer - A valid integer part.
 * @returns The previous integer part, or `undefined` below `SMALLEST_KEY_INTEGER`.
 */
export function decrementInteger(integer: string): string | undefined {
  const head = integer.charAt(0);
  const digits = digitValues(integer);
  const largest = BASE_62_DIGITS.length - 1;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const previous = (digits[index] ?? 0) - 1;
    if (previous >= 0) {
      digits[index] = previous;
      return head + digitText(digits);
    }
    digits[index] = largest;
  }
  if (head === 'a') return `Z${BASE_62_DIGITS.charAt(largest)}`;
  if (head === 'A') return undefined;
  const previousHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (previousHead < 'Z') digits.push(largest);
  else digits.pop();
  return previousHead + digitText(digits);
}

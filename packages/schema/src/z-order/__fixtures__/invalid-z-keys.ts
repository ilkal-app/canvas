import { MAX_KEY_LENGTH, SMALLEST_KEY_INTEGER } from '../key-rule.js';

/**
 * Strings that are not fractional-index keys, one per clause of the key rule, each with a label
 * naming the clause it breaks: for the object schema's `z` and the portable import.
 */
export const INVALID_Z_KEYS: readonly (readonly [label: string, key: string])[] = [
  ['an integer part shorter than its head states', 'b0'],
  ['a legacy key that is not a fractional index', 'legacy'],
  ['a head that is not a letter', '0a'],
  ['a fraction that ends in 0', 'a0V0'],
  ['a character outside base 62', 'a0-'],
  ['a non-ASCII character', 'a0é'],
  ['the smallest integer alone', SMALLEST_KEY_INTEGER],
  ['more than MAX_KEY_LENGTH characters', `a0${'V'.repeat(MAX_KEY_LENGTH - 1)}`],
];

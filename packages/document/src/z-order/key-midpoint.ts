import { BASE_62_DIGITS } from '@canvas/schema';

import { ZERO_DIGIT } from './key-integer.js';

/**
 * A base-62 fraction strictly between two fractions, as short as the halving allows.
 *
 * The fractions are digit strings read as 0.d₁d₂… in base 62, neither ending in zero. The
 * result never ends in zero, and it is never a prefix of `upper`: appending digits to it
 * keeps it below `upper`, which is what lets `generateObjectKeys` append a tag. That is this
 * function's change from Greenspan's `midpoint` (see `key-integer.ts`), which returns `upper`'s first
 * digit when the digits are adjacent and `upper` is longer; this returns the lower digit
 * followed by a midpoint above the rest of `lower` instead.
 *
 * @param lower - The lower fraction; `''` is zero.
 * @param upper - The upper fraction, or `null` for one (the fraction's ceiling).
 * @returns A fraction strictly between them.
 */
export function midpoint(lower: string, upper: string | null): string {
  if (upper !== null) {
    let shared = 0;
    while ((lower.charAt(shared) || ZERO_DIGIT) === upper.charAt(shared)) shared += 1;
    if (shared > 0) {
      return upper.slice(0, shared) + midpoint(lower.slice(shared), upper.slice(shared));
    }
  }
  const lowerDigit = lower === '' ? 0 : BASE_62_DIGITS.indexOf(lower.charAt(0));
  const upperDigit =
    upper === null ? BASE_62_DIGITS.length : BASE_62_DIGITS.indexOf(upper.charAt(0));
  if (upperDigit - lowerDigit > 1) {
    return BASE_62_DIGITS.charAt(Math.round((lowerDigit + upperDigit) / 2));
  }
  return BASE_62_DIGITS.charAt(lowerDigit) + midpoint(lower.slice(1), null);
}

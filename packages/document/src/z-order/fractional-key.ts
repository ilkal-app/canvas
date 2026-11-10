import { isWellFormedKey, SMALLEST_KEY_INTEGER } from '@canvas/schema';

import { decrementInteger, incrementInteger, integerPart } from './key-integer.js';
import { midpoint } from './key-midpoint.js';

// Fractional-index keys (z-order is a fractional index, never array
// position). A key is an integer part (a head letter giving its length, then base-62 digits)
// followed by a base-62 fraction that does not end in zero. Between any two distinct keys there
// is always another, so a move rewrites only the moved objects' keys and keys never need
// rebalancing. The scheme is Greenspan's (see key-integer.ts), with one change: a generated key
// is never a prefix of its upper bound (see key-midpoint.ts), so a suffix can be appended to it.
// Which strings are keys, and how keys compare, is the schema's rule (`isValidKey`,
// `compareKeys` in `@canvas/schema`): the keys the commands write stay a few characters long,
// and in the worst case pass `MAX_KEY_LENGTH` only after 2,525 placements (the README's growth
// bound).

/** The first key of an empty order: the integer zero. */
const FIRST_KEY = 'a0';

/**
 * Throws unless a bound is a well-formed key. Its length is not checked, so generation keeps
 * working past `MAX_KEY_LENGTH`; callers that store keys check it.
 *
 * @param key - The bound.
 * @param role - Which bound it is, for the message.
 * @throws {RangeError} When `key` is not well formed.
 */
function assertKey(key: string, role: 'lower' | 'upper'): void {
  if (!isWellFormedKey(key)) throw new RangeError(`The ${role} bound "${key}" is not a key`);
}

/**
 * A key between two valid keys, with `lower < upper`.
 *
 * @param lower - The lower bound.
 * @param upper - The upper bound.
 * @returns A key strictly between them, not a prefix of `upper`.
 */
function keyInside(lower: string, upper: string): string {
  const lowerInteger = integerPart(lower);
  const upperInteger = integerPart(upper);
  const lowerFraction = lower.slice(lowerInteger.length);
  if (lowerInteger === upperInteger) {
    return lowerInteger + midpoint(lowerFraction, upper.slice(upperInteger.length));
  }
  // The next integer is below `upper` and the shortest choice, unless it is `upper`'s own
  // integer part, which would be a prefix of `upper`.
  const next = incrementInteger(lowerInteger) ?? upperInteger;
  if (next !== upperInteger) return next;
  return lowerInteger + midpoint(lowerFraction, null);
}

/**
 * Generates a key strictly between two keys: the next integer above `lower` when `upper` is
 * null, the previous integer below `upper` when `lower` is null (so keys at the ends of the
 * order stay short), and a midpoint otherwise. Deterministic: the same bounds always give the
 * same key. The result is never a prefix of `upper`. Pure.
 *
 * @param lower - The key to sort above, or `null` for none (the back of the order).
 * @param upper - The key to sort below, or `null` for none (the front of the order).
 * @returns The new key; its length is not checked against `MAX_KEY_LENGTH`.
 * @throws {RangeError} When a bound is not a well-formed key (length aside), or `lower` is not
 *   below `upper`.
 */
export function generateKeyBetween(lower: string | null, upper: string | null): string {
  if (lower !== null) assertKey(lower, 'lower');
  if (upper !== null) assertKey(upper, 'upper');
  if (lower === null) {
    if (upper === null) return FIRST_KEY;
    const integer = integerPart(upper);
    const below = decrementInteger(integer);
    if (below === undefined) return integer + midpoint('', upper.slice(integer.length));
    // The smallest integer alone is not a key (nothing could sort below it): go inside it.
    return below === SMALLEST_KEY_INTEGER ? below + midpoint('', null) : below;
  }
  if (upper === null) {
    const integer = integerPart(lower);
    return incrementInteger(integer) ?? integer + midpoint(lower.slice(integer.length), null);
  }
  if (lower >= upper) {
    throw new RangeError(`The lower bound "${lower}" is not below the upper bound "${upper}"`);
  }
  return keyInside(lower, upper);
}

/**
 * Generates `count` ordered keys between two keys and passes each through `finish` before it
 * becomes a bound for the next, so `finish` may append to a key (it is never a prefix of its
 * upper bound). Keys go up from `lower` when `upper` is null, down from `upper` when `lower` is
 * null, and otherwise by bisection, so they spread evenly. Pure.
 *
 * @param lower - The key to sort above, or `null`.
 * @param upper - The key to sort below, or `null`.
 * @param count - How many keys; a non-negative integer.
 * @param finish - Maps a generated key and its index to the key to keep; must keep it valid
 *   and between the key and the key's upper bound.
 * @returns The keys, bottom to top.
 * @throws {RangeError} When `count` is not a non-negative integer, or a bound is invalid or the
 *   bounds are out of order.
 */
export function generateKeySequence(
  lower: string | null,
  upper: string | null,
  count: number,
  finish: (key: string, index: number) => string,
): string[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(`A key count must be a non-negative integer, got ${String(count)}`);
  }
  const keys = new Array<string>(count);
  const fill = (below: string | null, above: string | null, start: number, length: number) => {
    if (above === null) {
      let key = below;
      for (let index = start; index < start + length; index += 1) {
        key = finish(generateKeyBetween(key, null), index);
        keys[index] = key;
      }
    } else if (below === null) {
      let key = above;
      for (let index = start + length - 1; index >= start; index -= 1) {
        key = finish(generateKeyBetween(null, key), index);
        keys[index] = key;
      }
    } else if (length > 0) {
      const middle = start + Math.floor(length / 2);
      const key = finish(generateKeyBetween(below, above), middle);
      keys[middle] = key;
      fill(below, key, start, middle - start);
      fill(key, above, middle + 1, start + length - middle - 1);
    }
  };
  fill(lower, upper, 0, count);
  return keys;
}

/**
 * Generates `count` ordered keys between two keys, for placing several objects in one gap in
 * one step (a multi-object move or paste keeps the objects' relative order). Keys count up
 * from `lower` or down from `upper` at the open ends and bisect a bounded gap, so `n` keys in
 * a gap add about log₆₂(n) characters. Deterministic and pure.
 *
 * @param lower - The key to sort above, or `null` for none.
 * @param upper - The key to sort below, or `null` for none.
 * @param count - How many keys; a non-negative integer.
 * @returns The keys, bottom to top, strictly between the bounds.
 * @throws {RangeError} When `count` is not a non-negative integer, a bound is not a
 *   well-formed key, or `lower` is not below `upper`.
 */
export function generateNKeysBetween(
  lower: string | null,
  upper: string | null,
  count: number,
): string[] {
  return generateKeySequence(lower, upper, count, (key) => key);
}

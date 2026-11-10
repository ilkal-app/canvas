import { BASE_62_DIGITS, type ObjectId } from '@canvas/schema';

import { generateKeySequence } from './fractional-key.js';
import { ZERO_DIGIT } from './key-integer.js';

/** Hashed digits in an object's tag: about 1.5 × 10⁷ distinct tags. */
const TAG_DIGITS = 4;

/**
 * Hashes an object id to 32 bits: FNV-1a over its UTF-16 code units, then the MurmurHash3
 * finaliser so that ids differing in one character spread over every tag digit.
 *
 * @param id - The object id.
 * @returns An unsigned 32-bit hash.
 */
function hashId(id: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01_00_01_93);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85_eb_ca_6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2_b2_ae_35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * The tag appended to every key generated for an object: a `0` separator, then four base-62
 * digits derived from the object's id, the last one never zero (a key's fraction may not end in
 * zero).
 *
 * Why the digits: generation is deterministic, so two clients that concurrently move different
 * objects into the same gap would compute the same key, and the objects would tie. The digits
 * make their keys differ, so the merged order is total without any coordination. Two distinct
 * ids share a tag with probability about 1 in 1.5 × 10⁷; `sortedSiblings` breaks such a tie by
 * id.
 *
 * Why the separator: a midpoint computed next to a key reads that key's digits until it finds
 * room, and without the separator it would read into the tag, so the growth of keys placed
 * next to an object would depend on its tag's digits (a pair of objects with high tag digits
 * swapped back and forth grew keys about 2.5 times faster). A `0` always leaves room, so the
 * midpoint stops there: tagged keys grow exactly as untagged ones do, plus the five tag
 * characters (see the README's growth bound).
 *
 * @param id - The object id.
 * @returns The tag, five characters.
 */
export function objectKeyTag(id: ObjectId): string {
  let hash = hashId(id);
  let tag = ZERO_DIGIT;
  for (let index = 0; index < TAG_DIGITS - 1; index += 1) {
    tag += BASE_62_DIGITS.charAt(hash % BASE_62_DIGITS.length);
    hash = Math.floor(hash / BASE_62_DIGITS.length);
  }
  return tag + BASE_62_DIGITS.charAt(1 + (hash % (BASE_62_DIGITS.length - 1)));
}

/**
 * Generates keys for objects placed together in one gap, bottom to top in the order given, each
 * made unique to its object by a tag hashed from its id. Every key the document writes comes from
 * here, so concurrent placements in the same gap by different clients still merge into a total
 * order. Deterministic and pure: the same bounds and ids always
 * give the same keys.
 *
 * @param lower - The key to sort above, or `null` for the back of the order.
 * @param upper - The key to sort below, or `null` for the front of the order.
 * @param ids - The objects, in the order they are to stack (bottom first).
 * @returns One key per id, strictly increasing and strictly between the bounds.
 * @throws {RangeError} When a bound is not a well-formed key or `lower` is not below `upper`.
 */
export function generateObjectKeys(
  lower: string | null,
  upper: string | null,
  ids: readonly ObjectId[],
): string[] {
  return generateKeySequence(lower, upper, ids.length, (key, index) => {
    // `generateKeySequence` never passes a prefix of the upper bound, so the tag keeps the key
    // below it; and a longer key sorts above its own prefix, so it stays above the lower bound.
    const id = ids[index];
    return id === undefined ? key : key + objectKeyTag(id);
  });
}

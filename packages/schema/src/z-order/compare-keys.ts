import type { ObjectId } from '../ids/object-id.js';

/**
 * Compares two keys by UTF-16 code units, the order of `z`; usable as
 * an `Array#sort` comparator. Base-62 digits are in ascending code-unit order, so this is also
 * their numeric order. Not locale order: `Z` sorts below `a`. Pure.
 *
 * @param first - One key.
 * @param second - The other key.
 * @returns A negative number when `first` sorts below `second`, positive when above, else 0.
 */
export function compareKeys(first: string, second: string): number {
  if (first < second) return -1;
  return first > second ? 1 : 0;
}

/** What sibling order reads of an object: its id and its `z` key. */
export interface SiblingKey {
  /** The object id, which breaks ties between equal keys. */
  readonly id: ObjectId;
  /** Its fractional-index key among its siblings. */
  readonly z: string;
}

/**
 * The stacking order of siblings, bottom (drawn first) to top: by `z`, then by id when two keys
 * are equal (keys the command layer writes are unique, but a board merged from elsewhere may
 * hold duplicates), so every client stacks the same siblings the same way. The one rule shared
 * by `@canvas/document` (`sortedSiblings`, `topChildOf`, reorders) and `@canvas/engine` (paint
 * and pick order); usable as an `Array#sort` comparator. Pure.
 *
 * @param first - One sibling.
 * @param second - The other.
 * @returns A negative number when `first` stacks below `second`, positive when above, 0 when
 *   both key and id are equal.
 */
export function compareSiblings(first: SiblingKey, second: SiblingKey): number {
  return compareKeys(first.z, second.z) || compareKeys(first.id, second.id);
}

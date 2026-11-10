import { compareSiblings, type SiblingKey } from '@canvas/schema';

/** What stacking order reads of a sibling: its id and its `z` key (the schema's `SiblingKey`). */
export type StackingKey = SiblingKey;

/**
 * The stacking order of siblings, bottom first: by `z` compared by UTF-16 code units, then by id
 * when two keys are equal (a board merged from elsewhere may hold duplicates), so every client
 * stacks the same siblings the same way. It is the schema's `compareSiblings`, the one rule the
 * document package orders siblings by too, so paint and pick order cannot diverge from
 * the document's `sortedSiblings`. Pure.
 *
 * @param first - One sibling.
 * @param second - The other.
 * @returns A negative number when `first` stacks below `second`, positive when above.
 */
export function compareStacking(first: StackingKey, second: StackingKey): number {
  return compareSiblings(first, second);
}

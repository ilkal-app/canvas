// What a command's part costs: a stepped run applies a large command a part per
// browser task, so a part is bounded by the writes it plans, not only by its object count. An
// object written costs two (the object and the `updatedAt` stamp `runCommand` adds), a deletion
// one, and a side-table entry (a token, a named style, a page, a restore marker) one. The bound
// counts planned operations; it is neither bytes nor milliseconds, which a run measures.

/** The planned writes of setting one object: the object and its `updatedAt` stamp. */
export const OBJECT_WRITES = 2;
/** The planned writes of deleting one object. */
export const DELETE_WRITES = 1;
/** The planned writes of one side-table entry: a token, a named style, a page or a marker. */
export const ENTRY_WRITES = 1;

/**
 * Whether a write budget is usable: a positive whole number.
 *
 * @param maxWrites - The budget.
 * @returns `true` when it is a positive safe integer.
 */
export function isWriteBudget(maxWrites: number): boolean {
  return Number.isSafeInteger(maxWrites) && maxWrites > 0;
}

/** Writes a part carries besides its items (`packByWrites`). */
export interface PartReserve {
  /** Besides its items, in the first part only: a page the command creates. */
  readonly first?: number;
  /** Besides its items, in every part: a restore marker. */
  readonly each?: number;
  /** Besides its items, in the last part only: a page the command deletes. */
  readonly last?: number;
}

/**
 * Packs items, in order, into consecutive parts of at most `maxWrites` planned writes each. An
 * item costing more than the budget gets a part of its own (the run reports it over budget); the
 * order is kept, so items a later one refers to stay in the same or an earlier part.
 *
 * @param items - The items, in the order they must be written.
 * @param costOf - An item's planned writes.
 * @param maxWrites - The budget per part.
 * @param reserve - Writes the parts carry besides their items.
 * @returns The parts, in order; one empty part for no items.
 */
export function packByWrites<Item>(
  items: readonly Item[],
  costOf: (item: Item) => number,
  maxWrites: number,
  reserve: PartReserve = {},
): Item[][] {
  const each = reserve.each ?? 0;
  const parts: Item[][] = [];
  let part: Item[] = [];
  let used = each + (reserve.first ?? 0);
  for (const item of items) {
    const cost = costOf(item);
    if (part.length > 0 && used + cost > maxWrites) {
      parts.push(part);
      part = [];
      used = each;
    }
    part.push(item);
    used += cost;
  }
  parts.push(part);
  // The last part's own writes (a page deleted) go in a part of their own when it is full.
  if ((reserve.last ?? 0) > 0 && part.length > 0 && used + (reserve.last ?? 0) > maxWrites) {
    parts.push([]);
  }
  return parts;
}

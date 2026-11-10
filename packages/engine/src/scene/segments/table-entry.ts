/**
 * Reads one entry of an `Int32Array` table (the planner's tables by slot and by paint rank are
 * all `Int32Array`s, which keeps this read monomorphic and fast). Under `noUncheckedIndexedAccess` every indexed read
 * types as `number | undefined`; the planner's indexes are in range by construction, and an
 * index past the end reads as 0, the value a new table holds. Pure.
 *
 * @param table - The table.
 * @param index - The entry's index.
 * @returns The entry, or 0 past the end.
 */
export function tableEntry(table: Int32Array, index: number): number {
  return table[index] ?? 0;
}

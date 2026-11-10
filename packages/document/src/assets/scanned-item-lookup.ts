import type { ScannedItem, UpdateScan } from './update-scan.js';

/**
 * Finds the scanned item whose clock range contains an id, by binary search.
 *
 * @param scan - The scanned update.
 * @param client - The id's client.
 * @param clock - The id's clock.
 * @returns The item, or undefined when the id is not a scanned item (garbage-collected, text,
 *   or outside the update).
 */
export function findScannedItem(
  scan: UpdateScan,
  client: number,
  clock: number,
): ScannedItem | undefined {
  const items = scan.items.get(client);
  if (items === undefined) return undefined;
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const item = items[middle];
    if (item === undefined) return undefined;
    if (clock < item.clock) high = middle - 1;
    else if (clock >= item.clock + item.length) low = middle + 1;
    else return item;
  }
  return undefined;
}

/**
 * Finds the deleted range holding a clock of a client, by binary search (the ranges are sorted;
 * in a well-formed update they do not overlap).
 *
 * @param scan - The scanned update.
 * @param client - The client.
 * @param clock - The clock.
 * @returns The range's index in the client's ranges, or -1.
 */
function deletedRangeIndex(scan: UpdateScan, client: number, clock: number): number {
  const ranges = scan.deleted.get(client) ?? [];
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [start, length] = ranges[middle] ?? [0, 0];
    if (clock < start) high = middle - 1;
    else if (clock >= start + length) low = middle + 1;
    else return middle;
  }
  return -1;
}

/**
 * Tells whether the update's delete set covers a scanned item (its first clock). An item whose
 * content is already gone is never asked about.
 *
 * @param scan - The scanned update.
 * @param item - The item.
 * @returns True when the item is deleted.
 */
export function isScannedItemDeleted(scan: UpdateScan, item: ScannedItem): boolean {
  return deletedRangeIndex(scan, item.client, item.clock) >= 0;
}

/**
 * Tells whether the update's delete set covers every clock of a scanned item, across adjacent
 * ranges.
 *
 * @param scan - The scanned update.
 * @param item - The item.
 * @returns True when all of it is deleted.
 */
export function isScannedItemWhollyDeleted(scan: UpdateScan, item: ScannedItem): boolean {
  const ranges = scan.deleted.get(item.client) ?? [];
  let index = deletedRangeIndex(scan, item.client, item.clock);
  if (index < 0) return false;
  let covered = item.clock;
  for (
    let range = ranges[index];
    range !== undefined && range[0] <= covered;
    range = ranges[index]
  ) {
    covered = Math.max(covered, range[0] + range[1]);
    index += 1;
  }
  return covered >= item.clock + item.length;
}

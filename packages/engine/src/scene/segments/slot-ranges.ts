import type { InstanceRange } from '../scene-culler.js';

/**
 * Sorted disjoint ranges from ascending slots (repeats joined).
 *
 * @param slots - The slots, ascending.
 * @returns The ranges.
 */
export function rangesOf(slots: Iterable<number>): InstanceRange[] {
  const ranges: { start: number; count: number }[] = [];
  for (const slot of slots) {
    const last = ranges.at(-1);
    if (last !== undefined && last.start + last.count === slot) last.count += 1;
    else if (last === undefined || last.start + last.count < slot) {
      ranges.push({ start: slot, count: 1 });
    }
  }
  return ranges;
}

/**
 * Whether sorted disjoint ranges hold a slot, by binary search.
 *
 * @param ranges - The ranges.
 * @param slot - The slot.
 * @returns True when one holds it.
 */
export function holdsSlot(ranges: readonly InstanceRange[], slot: number): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle];
    if (range !== undefined && range.start + range.count <= slot) low = middle + 1;
    else high = middle;
  }
  const range = ranges[low];
  return range !== undefined && range.start <= slot;
}

/**
 * Sorted disjoint ranges joined: their union, adjacent ones joined.
 *
 * @param a - Sorted disjoint ranges.
 * @param b - Others.
 * @returns The union.
 */
function unionOf(
  a: readonly InstanceRange[],
  b: readonly InstanceRange[],
): { start: number; count: number }[] {
  const union: { start: number; count: number }[] = [];
  let left = 0;
  let right = 0;
  while (left < a.length || right < b.length) {
    const first = a[left];
    const second = b[right];
    const isFirst = second === undefined || (first !== undefined && first.start <= second.start);
    const range = isFirst ? first : second;
    if (range === undefined) break;
    if (isFirst) left += 1;
    else right += 1;
    const last = union.at(-1);
    const end = range.start + range.count;
    if (last !== undefined && range.start <= last.start + last.count) {
      last.count = Math.max(last.count, end - last.start);
    } else union.push({ start: range.start, count: range.count });
  }
  return union;
}

/**
 * Sorted disjoint ranges with others added and some taken out: `(ranges ∪ added) − removed`.
 * Linear in the ranges. Pure.
 *
 * @param ranges - Sorted disjoint ranges.
 * @param added - Sorted disjoint ranges to add.
 * @param removed - Sorted disjoint ranges to take out.
 * @returns New sorted disjoint ranges.
 */
export function patchRanges(
  ranges: readonly InstanceRange[],
  added: readonly InstanceRange[],
  removed: readonly InstanceRange[],
): InstanceRange[] {
  const result: InstanceRange[] = [];
  let cut = 0;
  for (const { start, count } of unionOf(ranges, added)) {
    let cursor = start;
    const end = start + count;
    for (let gap = removed[cut]; gap !== undefined && gap.start + gap.count <= cursor;) {
      cut += 1;
      gap = removed[cut];
    }
    for (let index = cut; index < removed.length; index += 1) {
      const gap = removed[index];
      if (gap === undefined || gap.start >= end) break;
      if (gap.start > cursor) result.push({ start: cursor, count: gap.start - cursor });
      cursor = Math.max(cursor, gap.start + gap.count);
    }
    if (cursor < end) result.push({ start: cursor, count: end - cursor });
  }
  return result;
}

/**
 * Ascending unique values of a list, sorted in place.
 *
 * @param values - The values.
 * @returns The unique values.
 */
function uniqueSorted(values: number[]): number[] {
  values.sort((a, b) => a - b);
  return values.filter((value, index) => index === 0 || values[index - 1] !== value);
}

/**
 * Slot changes to one set of slots, netted when read: a slot both added and removed (in either
 * order, any number of times) is no change. Adding is cheap; the netting is paid once, by sorting.
 */
export class SlotChanges {
  private readonly addedSlots: number[] = [];
  private readonly removedSlots: number[] = [];
  private netted: { added: InstanceRange[]; removed: InstanceRange[] } | undefined;

  /**
   * Notes a slot added.
   *
   * @param slot - The slot.
   */
  add(slot: number): void {
    this.addedSlots.push(slot);
    this.netted = undefined;
  }

  /**
   * Notes a slot removed.
   *
   * @param slot - The slot.
   */
  remove(slot: number): void {
    this.removedSlots.push(slot);
    this.netted = undefined;
  }

  /**
   * The slots added, as sorted ranges.
   *
   * @returns The ranges.
   */
  added(): InstanceRange[] {
    return this.net().added;
  }

  /**
   * The slots removed, as sorted ranges.
   *
   * @returns The ranges.
   */
  removed(): InstanceRange[] {
    return this.net().removed;
  }

  /**
   * Nets the changes: what was both added and removed cancels.
   *
   * @returns The net changes, as sorted ranges.
   */
  private net(): { added: InstanceRange[]; removed: InstanceRange[] } {
    if (this.netted !== undefined) return this.netted;
    const added = uniqueSorted(this.addedSlots);
    const removed = uniqueSorted(this.removedSlots);
    const netAdded: number[] = [];
    const netRemoved: number[] = [];
    let a = 0;
    let r = 0;
    while (a < added.length || r < removed.length) {
      const x = added[a];
      const y = removed[r];
      if (x !== undefined && (y === undefined || x < y)) {
        netAdded.push(x);
        a += 1;
      } else if (y !== undefined && (x === undefined || y < x)) {
        netRemoved.push(y);
        r += 1;
      } else {
        a += 1;
        r += 1;
      }
    }
    this.netted = { added: rangesOf(netAdded), removed: rangesOf(netRemoved) };
    return this.netted;
  }
}

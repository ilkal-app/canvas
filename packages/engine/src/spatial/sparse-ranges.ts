import type { InstanceRange } from '../scene/scene-culler.js';

/** Ordered disjoint intervals; updates inspect overlapping runs rather than every slot. */
export class SparseRanges {
  private readonly runs: InstanceRange[];
  private snapshot: readonly InstanceRange[] | undefined;

  /**
   * Starts with sorted, disjoint, non-touching intervals.
   *
   * @param ranges - Initial intervals, copied so callers retain ownership.
   */
  constructor(ranges: readonly InstanceRange[] = []) {
    this.runs = ranges.map(({ start, count }) => ({ start, count }));
  }

  /**
   * Reads a retained immutable snapshot.
   *
   * @returns The intervals, with a new array only after an actual change.
   */
  values(): readonly InstanceRange[] {
    this.snapshot ??= this.runs.slice();
    return this.snapshot;
  }

  /**
   * Finds the interval containing a slot.
   *
   * @param slot - The slot.
   * @returns Its interval, if marked.
   */
  containing(slot: number): InstanceRange | undefined {
    const run = this.runs[this.firstEndingAfter(slot)];
    return run && run.start <= slot ? run : undefined;
  }

  /**
   * Finds the nearest marked slot strictly before a slot.
   *
   * @param slot - The search position.
   * @returns The predecessor, if any.
   */
  before(slot: number): number | undefined {
    const index = this.firstEndingAfter(slot - 1);
    const current = this.runs[index];
    if (current && current.start < slot) return slot - 1;
    const previous = this.runs[index - 1];
    return previous && previous.start + previous.count - 1;
  }

  /**
   * Finds the nearest marked slot strictly after a slot.
   *
   * @param slot - The search position.
   * @returns The successor, if any.
   */
  after(slot: number): number | undefined {
    const next = this.runs[this.firstEndingAfter(slot + 1)];
    return next && Math.max(next.start, slot + 1);
  }

  /**
   * Marks an interval and merges touching neighbors.
   *
   * @param range - Slots to mark.
   * @param range.start - The first slot.
   * @param range.count - The number of slots.
   * @returns Only newly marked intervals.
   */
  add({ start, count }: InstanceRange): readonly InstanceRange[] {
    if (count <= 0) return [];
    const end = start + count;
    const first = this.firstEndingAfter(start - 1);
    let last = first;
    let mergedStart = start;
    let mergedEnd = end;
    let cursor = start;
    const added: InstanceRange[] = [];
    while (last < this.runs.length) {
      const run = this.runs[last];
      if (!run || run.start > end) break;
      if (run.start > cursor)
        added.push({ start: cursor, count: Math.min(end, run.start) - cursor });
      cursor = Math.max(cursor, run.start + run.count);
      mergedStart = Math.min(mergedStart, run.start);
      mergedEnd = Math.max(mergedEnd, run.start + run.count);
      last += 1;
    }
    if (cursor < end) added.push({ start: cursor, count: end - cursor });
    if (added.length === 0) return added;
    this.runs.splice(first, last - first, { start: mergedStart, count: mergedEnd - mergedStart });
    this.snapshot = undefined;
    return added;
  }

  /**
   * Unmarks an interval, splitting its overlapping runs.
   *
   * @param range - Slots to unmark.
   * @param range.start - The first slot.
   * @param range.count - The number of slots.
   * @returns Only previously marked intervals removed.
   */
  remove({ start, count }: InstanceRange): readonly InstanceRange[] {
    if (count <= 0) return [];
    const end = start + count;
    const first = this.firstEndingAfter(start);
    let last = first;
    const kept: InstanceRange[] = [];
    const removed: InstanceRange[] = [];
    while (last < this.runs.length) {
      const run = this.runs[last];
      if (!run || run.start >= end) break;
      const runEnd = run.start + run.count;
      const from = Math.max(start, run.start);
      const to = Math.min(end, runEnd);
      removed.push({ start: from, count: to - from });
      if (run.start < start) kept.push({ start: run.start, count: start - run.start });
      if (runEnd > end) kept.push({ start: end, count: runEnd - end });
      last += 1;
    }
    if (removed.length > 0) {
      this.runs.splice(first, last - first, ...kept);
      this.snapshot = undefined;
    }
    return removed;
  }

  private firstEndingAfter(slot: number): number {
    let low = 0;
    let high = this.runs.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const run = this.runs[middle];
      if (run && run.start + run.count <= slot) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}

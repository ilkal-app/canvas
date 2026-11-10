import type { InstanceRange } from './scene-culler.js';

/** One page's share of a paged pass's ranges. */
export interface PageRanges {
  /** The page. */
  readonly page: number;
  /** Its records, as ranges of consecutive slots, in slot order. */
  readonly ranges: readonly InstanceRange[];
}

/**
 * Splits a paged pass's instance ranges by the page each slot samples (draw calls are bounded
 * by passes times atlas pages times opaque segments): each page gets the runs of consecutive slots
 * on it, so one entry becomes at most one entry per page. Slots past the table read as page 0.
 * Pure; O(records in the ranges).
 *
 * @param ranges - The ranges, in the order they draw.
 * @param pageBySlot - Each slot's page (`Scene.pagesOf`).
 * @returns One entry per page drawn, pages ascending; empty when the ranges are.
 */
export function splitRangesByPage(
  ranges: readonly InstanceRange[],
  pageBySlot: Int32Array,
): PageRanges[] {
  const byPage = new Map<number, InstanceRange[]>();
  for (const { start, count } of ranges) {
    let runStart = start;
    let runPage = pageBySlot[start] ?? 0;
    for (let slot = start + 1; slot <= start + count; slot += 1) {
      const page = slot < start + count ? (pageBySlot[slot] ?? 0) : Number.NaN;
      if (page === runPage) continue;
      if (slot > runStart) {
        const list = byPage.get(runPage) ?? [];
        const last = list.at(-1);
        // Runs of one page separated only by other pages' slots stay separate ranges; runs that
        // touch (two input ranges back to back) join.
        if (last !== undefined && last.start + last.count === runStart) {
          list[list.length - 1] = { start: last.start, count: last.count + slot - runStart };
        } else {
          list.push({ start: runStart, count: slot - runStart });
        }
        byPage.set(runPage, list);
      }
      runStart = slot;
      runPage = page;
    }
  }
  return [...byPage.entries()]
    .sort(([first], [second]) => first - second)
    .map(([page, pageRanges]) => ({ page, ranges: pageRanges }));
}

import type { InstanceRange } from '../scene-culler.js';

/**
 * Removes sorted disjoint intervals from ranges that may be in arbitrary paint order.
 *
 * @param ranges - Existing draw runs, in paint order.
 * @param removed - Removed live slots, ascending and disjoint.
 * @returns The remaining runs in the same paint order.
 */
export function subtractRanges(
  ranges: readonly InstanceRange[],
  removed: readonly InstanceRange[],
): InstanceRange[] {
  const result: InstanceRange[] = [];
  for (const range of ranges) {
    let cursor = range.start;
    const end = range.start + range.count;
    let low = 0;
    let high = removed.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const candidate = removed[middle];
      if (candidate && candidate.start + candidate.count <= cursor) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < removed.length; index += 1) {
      const cut = removed[index];
      if (!cut || cut.start >= end) break;
      if (cut.start > cursor) result.push({ start: cursor, count: cut.start - cursor });
      cursor = Math.max(cursor, Math.min(end, cut.start + cut.count));
    }
    if (cursor < end) result.push({ start: cursor, count: end - cursor });
  }
  return result;
}

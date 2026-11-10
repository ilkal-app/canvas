import type { DrawListEntry } from '../draw-list.js';

/**
 * Whether two draw lists name the same passes and ranges, in the same order.
 *
 * @param first - One draw list.
 * @param second - The other.
 * @returns Whether they are equal entry by entry and range by range.
 */
export function isSameDrawList(
  first: readonly DrawListEntry[],
  second: readonly DrawListEntry[],
): boolean {
  if (first.length !== second.length) return false;
  return first.every((entry, index) => {
    const other = second[index];
    if (
      other?.passName !== entry.passName ||
      other.page !== entry.page ||
      other.ranges.length !== entry.ranges.length
    ) {
      return false;
    }
    return entry.ranges.every((range, rangeIndex) => {
      const otherRange = other.ranges[rangeIndex];
      return otherRange?.start === range.start && otherRange.count === range.count;
    });
  });
}

/**
 * Copies range values so mutable culler arrays cannot alter the previous frame's snapshot.
 *
 * @param entries - The cull stage's draw list.
 * @returns An independent snapshot.
 */
export function copyDrawList(entries: readonly DrawListEntry[]): DrawListEntry[] {
  return entries.map(({ passName, page, ranges }) => ({
    passName,
    ...(page === undefined ? {} : { page }),
    ranges: ranges.map(({ start, count }) => ({ start, count })),
  }));
}

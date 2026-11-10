import type { WorldBounds } from '../camera/camera.js';

/**
 * Groups boxes into R-tree nodes with Sort-Tile-Recursive packing (Leutenegger, Lopez and
 * Edgington 1997, "STR: a simple and efficient algorithm for R-tree packing"): sort by centre x,
 * cut into about √(nodes) vertical slices, sort each slice by centre y and cut it into runs of
 * at most `maxEntries`. Applied level by level it builds a whole tree in O(n log n) with nodes
 * that barely overlap, much faster than n inserts. Slices and runs are cut evenly rather than
 * greedily, so no group is left with a handful of entries: every group holds at least half of
 * `maxEntries` whenever there are that many boxes.
 *
 * @param boxes - The boxes of one level; not mutated.
 * @param maxEntries - The most boxes a group may hold.
 * @returns The groups, each non-empty; together they hold every box once.
 */
export function strPack<T extends WorldBounds>(boxes: readonly T[], maxEntries: number): T[][] {
  const nodeCount = Math.ceil(boxes.length / maxEntries);
  const sliceCount = Math.ceil(Math.sqrt(nodeCount));
  const byX = [...boxes].sort((a, b) => a.minX + a.maxX - (b.minX + b.maxX));
  const groups: T[][] = [];
  for (const slice of cutEvenly(byX, sliceCount)) {
    slice.sort((a, b) => a.minY + a.maxY - (b.minY + b.maxY));
    groups.push(...cutEvenly(slice, Math.ceil(slice.length / maxEntries)));
  }
  return groups;
}

/**
 * Cuts a list into consecutive runs whose lengths differ by at most one.
 *
 * @param items - The list.
 * @param runCount - How many runs, at least 1.
 * @returns The runs, in order; none is empty when `items` has at least `runCount` items.
 */
function cutEvenly<T>(items: readonly T[], runCount: number): T[][] {
  const runs: T[][] = [];
  let start = 0;
  for (let run = 0; run < runCount; run += 1) {
    const end = Math.round(((run + 1) * items.length) / runCount);
    if (end > start) runs.push(items.slice(start, end));
    start = end;
  }
  return runs;
}

import type { WorldBounds } from '../camera/camera.js';

import { boundsArea, enlargedArea, unionBounds } from './bounds.js';

/**
 * Splits an overfull R-tree node's entries into two groups with Guttman's quadratic split
 * (Guttman 1984, "R-trees: a dynamic index structure for spatial searching", section 3.5.2): seed the
 * groups with the pair that would waste the most area together, then repeatedly place the entry
 * with the strongest preference for one group into the group it enlarges least. It is O(n²) in
 * the node's capacity, which is small (16), and gives nodes with little overlap.
 *
 * @param entries - The entries, at least two, each a distinct object; not mutated.
 * @param minEntries - The fewest entries a group may end with, at most half of `entries`.
 * @returns The two groups; together they hold every entry once.
 * @throws {RangeError} When there are fewer than two entries.
 */
export function quadraticSplit<T extends WorldBounds>(
  entries: readonly T[],
  minEntries: number,
): [T[], T[]] {
  const seeds = pickSeeds(entries);
  const first: T[] = [seeds.first];
  const second: T[] = [seeds.second];
  let firstBounds: WorldBounds = seeds.first;
  let secondBounds: WorldBounds = seeds.second;
  const remaining = entries.filter((entry) => entry !== seeds.first && entry !== seeds.second);
  while (remaining.length > 0) {
    // A group that needs every remaining entry to reach the minimum takes them all.
    if (first.length + remaining.length === minEntries) {
      first.push(...remaining);
      break;
    }
    if (second.length + remaining.length === minEntries) {
      second.push(...remaining);
      break;
    }
    const [entry] = remaining.splice(pickNext(remaining, firstBounds, secondBounds), 1);
    if (!entry) break;
    if (prefersFirst(entry, first.length, second.length, firstBounds, secondBounds)) {
      first.push(entry);
      firstBounds = unionBounds(firstBounds, entry);
    } else {
      second.push(entry);
      secondBounds = unionBounds(secondBounds, entry);
    }
  }
  return [first, second];
}

/**
 * The pair of entries whose shared box wastes the most area: the two that belong apart.
 *
 * @param entries - The entries, at least two.
 * @returns The pair.
 * @throws {RangeError} When there are fewer than two entries.
 */
function pickSeeds<T extends WorldBounds>(entries: readonly T[]): { first: T; second: T } {
  let seeds: { first: T; second: T } | undefined;
  let worstWaste = Number.NEGATIVE_INFINITY;
  entries.forEach((first, firstIndex) => {
    for (const second of entries.slice(firstIndex + 1)) {
      const waste = enlargedArea(first, second) - boundsArea(first) - boundsArea(second);
      if (waste > worstWaste) {
        worstWaste = waste;
        seeds = { first, second };
      }
    }
  });
  if (!seeds) throw new RangeError('A quadratic split needs at least two entries.');
  return seeds;
}

/**
 * The remaining entry with the greatest difference between the growth each group would need.
 *
 * @param remaining - The unplaced entries.
 * @param firstBounds - The first group's box.
 * @param secondBounds - The second group's box.
 * @returns Its index in `remaining`.
 */
function pickNext(
  remaining: readonly WorldBounds[],
  firstBounds: WorldBounds,
  secondBounds: WorldBounds,
): number {
  const firstArea = boundsArea(firstBounds);
  const secondArea = boundsArea(secondBounds);
  let best = 0;
  let bestPreference = Number.NEGATIVE_INFINITY;
  remaining.forEach((entry, index) => {
    const preference = Math.abs(
      enlargedArea(firstBounds, entry) -
        firstArea -
        (enlargedArea(secondBounds, entry) - secondArea),
    );
    if (preference > bestPreference) {
      bestPreference = preference;
      best = index;
    }
  });
  return best;
}

/**
 * Whether an entry goes to the first group: the one it enlarges less, then the smaller one,
 * then the one with fewer entries.
 *
 * @param entry - The entry.
 * @param firstCount - Entries in the first group.
 * @param secondCount - Entries in the second group.
 * @param firstBounds - The first group's box.
 * @param secondBounds - The second group's box.
 * @returns True for the first group.
 */
function prefersFirst(
  entry: WorldBounds,
  firstCount: number,
  secondCount: number,
  firstBounds: WorldBounds,
  secondBounds: WorldBounds,
): boolean {
  const firstArea = boundsArea(firstBounds);
  const secondArea = boundsArea(secondBounds);
  const firstGrowth = enlargedArea(firstBounds, entry) - firstArea;
  const secondGrowth = enlargedArea(secondBounds, entry) - secondArea;
  if (firstGrowth !== secondGrowth) return firstGrowth < secondGrowth;
  if (firstArea !== secondArea) return firstArea < secondArea;
  return firstCount <= secondCount;
}

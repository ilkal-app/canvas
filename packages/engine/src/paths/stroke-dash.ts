import type { DashPattern } from './stroke-outline.js';

/**
 * The most dashes one stroke is cut into. A pattern of tiny lengths along a long stroke
 * would otherwise build a mesh of millions of triangles; past this, the stroke draws solid. At
 * 10,000 dashes of a few dozen vertices each the mesh stays within a few megabytes.
 */
export const MAX_DASHES = 10_000;

/** A dash: where it starts and ends along the stroke, world units; equal for a dash of length 0. */
export type DashInterval = readonly [start: number, end: number];

/**
 * The pattern with an odd count repeated, as SVG does (`[4]` is 4 on, 4 off).
 *
 * @param pattern - The lengths.
 * @returns An even count of lengths.
 */
function evenPattern(pattern: readonly number[]): readonly number[] {
  return pattern.length % 2 === 0 ? pattern : [...pattern, ...pattern];
}

/**
 * Adds one dash, clipped to the stroke: a dash of length 0 within it as a point, a longer one
 * where it overlaps the stroke.
 *
 * @param dashes - The dashes so far; added to.
 * @param at - Where the dash starts along the stroke, world units (may be before it).
 * @param entry - Its length.
 * @param length - The stroke's length.
 */
function pushDash(dashes: DashInterval[], at: number, entry: number, length: number): void {
  const end = at + entry;
  if (entry === 0) {
    if (at >= 0) dashes.push([at, at]);
  } else if (end > 0 && at < length) {
    dashes.push([Math.max(at, 0), Math.min(end, length)]);
  }
}

/**
 * Where the dashes of a pattern fall along a stroke of a given length (SVG's
 * `stroke-dasharray` and `stroke-dashoffset`): the pattern starts `offset` into itself at the
 * stroke's start, repeats to its end, and each dash (each even entry) clipped to the stroke is an
 * interval. A dash of length 0 within the stroke is kept as a point (its caps draw a dot). Pure.
 *
 * @param length - The stroke's length, world units, at least 0.
 * @param dash - The pattern and offset; not mutated.
 * @returns The dashes in order along the stroke; `undefined` when the stroke draws solid: a
 *   pattern whose lengths sum to 0 or are not finite, or more than {@link MAX_DASHES} dashes.
 */
export function dashIntervals(length: number, dash: DashPattern): DashInterval[] | undefined {
  const pattern = evenPattern(dash.pattern);
  const period = pattern.reduce((sum, entry) => sum + entry, 0);
  if (!(period > 0) || !Number.isFinite(period) || !Number.isFinite(dash.offset)) return undefined;
  const dashesPerPeriod = pattern.length / 2;
  if ((Math.ceil(length / period) + 1) * dashesPerPeriod > MAX_DASHES) return undefined;
  const phase = ((dash.offset % period) + period) % period;
  const dashes: DashInterval[] = [];
  let at = 0 - phase;
  while (at <= length) {
    for (const [index, entry] of pattern.entries()) {
      if (at > length) break;
      if (index % 2 === 0) pushDash(dashes, at, entry, length);
      at += entry;
    }
  }
  return dashes;
}

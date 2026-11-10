import type { Crop } from '@canvas/schema';

/**
 * How far short of the requirement the current level may fall before the manager switches up,
 * as a fraction: while zooming in, a level is kept until it would be stretched more than 10%.
 */
export const LEVEL_UP_SLACK = 0.1;

/**
 * How much room a smaller level must have before the manager switches down to it, as the share
 * of it the requirement may use: while zooming out, a level is kept until a smaller one would
 * be at most 80% used. Together with {@link LEVEL_UP_SLACK} this is the hysteresis band that
 * stops a level flipping on every zoom step.
 */
export const LEVEL_DOWN_RATIO = 0.8;

/** A width and height. */
export interface Size {
  /** The width. */
  readonly width: number;
  /** The height. */
  readonly height: number;
}

/**
 * The long edge, in px, an image level needs so that each of its pixels covers at most one
 * device pixel where the image is shown: the on-screen size times the device pixel ratio,
 * scaled up by the crop (a crop shows part of the level, so the whole
 * level must be larger), on whichever axis needs more. Pure.
 *
 * @param boxSize - The image object's box, world units.
 * @param naturalSize - The original's size, px: gives the levels' aspect ratio.
 * @param crop - The part of the image shown, in fractions of its size.
 * @param zoom - The camera zoom, CSS px per world unit.
 * @param dpr - Device px per CSS px.
 * @returns The required long edge, px; 0 for an empty box.
 */
export function requiredLongEdgePx(
  boxSize: Size,
  naturalSize: Size,
  crop: Crop,
  zoom: number,
  dpr: number,
): number {
  const scale = zoom * dpr;
  const longEdge = Math.max(naturalSize.width, naturalSize.height);
  // The whole image's size on screen, device px, per axis; then the long edge each axis implies.
  const byWidth = ((boxSize.width * scale) / crop.width) * (longEdge / naturalSize.width);
  const byHeight = ((boxSize.height * scale) / crop.height) * (longEdge / naturalSize.height);
  return Math.max(byWidth, byHeight);
}

/**
 * Picks the level to show from the available long edges, with hysteresis: without
 * a previous level, the smallest that meets `requiredPx` (the largest when none
 * does). With one, it is kept while it is at most {@link LEVEL_UP_SLACK} short and until a
 * smaller level would be at most {@link LEVEL_DOWN_RATIO} used; then the manager moves to the
 * level the requirement calls for. Pure.
 *
 * @param requiredPx - The long edge needed, px (`requiredLongEdgePx`).
 * @param available - The available levels' long edges, px, smallest first.
 * @param previous - The level shown until now, if any.
 * @returns The long edge of the level to show.
 * @throws {RangeError} When no level is available.
 */
export function pickLevel(
  requiredPx: number,
  available: readonly number[],
  previous: number | undefined,
): number {
  const largest = available.at(-1);
  if (largest === undefined) throw new RangeError('An image needs at least one level to pick.');
  const fitting = available.find((level) => level >= requiredPx) ?? largest;
  if (previous === undefined || !available.includes(previous) || fitting === previous) {
    return fitting;
  }
  if (fitting > previous) {
    return requiredPx > previous * (1 + LEVEL_UP_SLACK) ? fitting : previous;
  }
  // Zooming out: the smallest level below the current one that still has room to spare.
  return (
    available.find((level) => level < previous && requiredPx < level * LEVEL_DOWN_RATIO) ?? previous
  );
}

/**
 * The size of the level with a given long edge: the original scaled so its long edge is
 * `longEdgePx`, each side rounded and at least 1 px. Pure.
 *
 * @param naturalSize - The original's size, px.
 * @param longEdgePx - The level's long edge, px.
 * @returns The level's size, px.
 */
export function levelSize(naturalSize: Size, longEdgePx: number): Size {
  const scale = longEdgePx / Math.max(naturalSize.width, naturalSize.height);
  return {
    width: Math.max(1, Math.round(naturalSize.width * scale)),
    height: Math.max(1, Math.round(naturalSize.height * scale)),
  };
}

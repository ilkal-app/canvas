/**
 * The nearest two dots of the grid ever are on screen, CSS px: the spacing doubles before the
 * dots come closer.
 */
export const GRID_MIN_SPACING_PX = 16;

/** The dots are always closer than this on screen, CSS px: the spacing halves before they part. */
export const GRID_MAX_SPACING_PX = 32;

/**
 * The dot grid's spacing at a zoom, world units: the power of two whose screen size is at least
 * {@link GRID_MIN_SPACING_PX} and under {@link GRID_MAX_SPACING_PX}, so the grid is
 * screen-stable (it doubles as the view zooms out and halves as it zooms in) and every coarser
 * grid's dots are a subset of a finer one's, all through the world origin. Snapping to the grid
 * uses the same spacing, so a box snaps to the dots on screen. Pure.
 *
 * @param zoom - The camera zoom, CSS px per world unit.
 * @returns The spacing, world units.
 * @throws {RangeError} When the zoom is not positive and finite.
 */
export function gridSpacingAt(zoom: number): number {
  if (!(zoom > 0 && Number.isFinite(zoom))) {
    throw new RangeError(`A grid needs a positive, finite zoom, got ${String(zoom)}.`);
  }
  // Powers of two are exact, so the loops land on the bounds without rounding drift; the zoom
  // range (0.02×–64×) keeps them to a dozen steps.
  let spacing = 1;
  while (spacing * zoom < GRID_MIN_SPACING_PX) spacing *= 2;
  while (spacing * zoom >= GRID_MAX_SPACING_PX) spacing /= 2;
  return spacing;
}

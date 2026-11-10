/**
 * At and above this zoom the dot grid is fully visible. The fade band is one octave,
 * from here down to {@link GRID_FADE_HIDDEN_ZOOM}: exactly one doubling of the grid's spacing
 * (`gridSpacingAt`), so the fade spans one step of the lattice.
 */
export const GRID_FADE_FULL_ZOOM = 0.25;

/** At and below this zoom the dot grid is not drawn at all: no uniform write, no draw call. */
export const GRID_FADE_HIDDEN_ZOOM = 0.125;

/**
 * How strongly the dot grid shows at a zoom, 0 to 1: 1 at and above
 * {@link GRID_FADE_FULL_ZOOM}, 0 at and below {@link GRID_FADE_HIDDEN_ZOOM}, and a smoothstep
 * between them (half at 18.75%), whose slope is zero at both ends, so a zoom sweep through the
 * band never pops. It scales the dots' alpha only; snapping to the grid is unaffected and works
 * at any zoom. Pure.
 *
 * @param zoom - The camera zoom, CSS px per world unit.
 * @returns The grid's opacity.
 * @throws {RangeError} When the zoom is not positive and finite.
 */
export function gridOpacityAt(zoom: number): number {
  if (!(zoom > 0 && Number.isFinite(zoom))) {
    throw new RangeError(`A grid needs a positive, finite zoom, got ${String(zoom)}.`);
  }
  if (zoom >= GRID_FADE_FULL_ZOOM) return 1;
  if (zoom <= GRID_FADE_HIDDEN_ZOOM) return 0;
  const t = (zoom - GRID_FADE_HIDDEN_ZOOM) / (GRID_FADE_FULL_ZOOM - GRID_FADE_HIDDEN_ZOOM);
  return t * t * (3 - 2 * t);
}

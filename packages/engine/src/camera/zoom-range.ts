/** The smallest camera zoom factor, 0.02×: one screen pixel shows 50 world units. */
export const MIN_ZOOM = 0.02;

/** The largest camera zoom factor, 64×: one world unit spans 64 screen pixels. */
export const MAX_ZOOM = 64;

/**
 * Clamps a requested camera zoom factor to [{@link MIN_ZOOM}, {@link MAX_ZOOM}], the range a
 * person can navigate. The frame budgets are measured
 * over the narrower 0.05×–32× sweep inside it.
 *
 * @param zoom - The requested zoom factor, in screen pixels per world unit.
 * @returns The zoom factor limited to the supported range.
 * @throws {RangeError} When `zoom` is NaN, which has no place in the range.
 */
export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) {
    throw new RangeError('A zoom factor must be a number; received NaN.');
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

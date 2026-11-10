import type { WorldBounds } from '../camera/camera.js';

/** Rings per half viewport: an entry's distance from the centre is known to within 1/8. */
const RINGS_PER_HALF = 8;

/** Rings for the padding, beyond the viewport: four more half viewports, the last open-ended. */
const PADDING_RINGS = 4 * RINGS_PER_HALF;

/** Every ring: the viewport's, then the padding's. */
export const ADMISSION_RING_COUNT = RINGS_PER_HALF + PADDING_RINGS;

/**
 * How far a box is from the viewport's centre, in half viewports: the larger of the horizontal
 * and vertical gaps from the centre to the box's nearest point, each over the viewport's half
 * size. 0 for a box over the centre, at most 1 for one meeting the viewport.
 *
 * @param bounds - The box.
 * @param viewport - The unpadded viewport.
 * @returns The distance, at least 0.
 */
export function centreDistance(bounds: WorldBounds, viewport: WorldBounds): number {
  const halfWidth = (viewport.maxX - viewport.minX) / 2;
  const halfHeight = (viewport.maxY - viewport.minY) / 2;
  const x = viewport.minX + halfWidth;
  const y = viewport.minY + halfHeight;
  const dx = Math.max(0, bounds.minX - x, x - bounds.maxX);
  const dy = Math.max(0, bounds.minY - y, y - bounds.maxY);
  return Math.max(halfWidth > 0 ? dx / halfWidth : 0, halfHeight > 0 ? dy / halfHeight : 0);
}

/**
 * The ring a visible-set entry is admitted in under a budget: rings are 1/8 of a half
 * viewport wide and admitted nearest the centre first, every ring of the viewport before any of
 * the padding, so ordering costs one bucket per entry instead of a sort.
 *
 * @param bounds - The entry's box.
 * @param viewport - The unpadded viewport.
 * @param isInView - Whether the box meets the viewport (and not only its padding).
 * @returns The ring, from 0 to `ADMISSION_RING_COUNT - 1`.
 */
export function admissionRing(
  bounds: WorldBounds,
  viewport: WorldBounds,
  isInView: boolean,
): number {
  const distance = centreDistance(bounds, viewport);
  if (isInView) return Math.min(RINGS_PER_HALF - 1, Math.floor(distance * RINGS_PER_HALF));
  const beyond = Math.floor(Math.max(0, distance - 1) * RINGS_PER_HALF);
  return RINGS_PER_HALF + Math.min(PADDING_RINGS - 1, beyond);
}

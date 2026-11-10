import type { Camera } from './camera.js';

/**
 * Whether a camera differs from another only in where it looks: the same zoom, density and
 * viewport size, so every image keeps its level.
 *
 * @param first - One camera.
 * @param second - The other.
 * @returns True for a pan (or no move).
 */
export function isSameScale(first: Camera, second: Camera): boolean {
  return (
    first.zoom === second.zoom &&
    first.dpr === second.dpr &&
    first.viewportWidthPx === second.viewportWidthPx &&
    first.viewportHeightPx === second.viewportHeightPx
  );
}

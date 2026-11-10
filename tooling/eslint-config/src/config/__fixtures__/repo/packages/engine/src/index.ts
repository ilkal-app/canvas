/**
 * Clamps a fixture zoom factor to the supported range.
 *
 * @param zoom - The requested zoom factor.
 * @returns The zoom factor clamped to [0.05, 32].
 */
export function clampZoom(zoom: number): number {
  return Math.min(32, Math.max(0.05, zoom));
}

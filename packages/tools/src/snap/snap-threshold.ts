/**
 * How close an edge or centre must come to a line before it snaps, CSS px, whatever the zoom.
 */
export const SNAP_THRESHOLD_PX = 6;

/**
 * The snap threshold in world units at a zoom: {@link SNAP_THRESHOLD_PX} divided by the zoom,
 * so snapping feels the same at every zoom. Pure.
 *
 * @param zoom - The camera zoom, CSS px per world unit; greater than 0.
 * @returns The threshold, world units.
 */
export function snapThresholdAt(zoom: number): number {
  return SNAP_THRESHOLD_PX / zoom;
}

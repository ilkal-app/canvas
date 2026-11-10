import type { Point } from '@canvas/schema';

import { HANDLE_SIZE_PX } from '../select/handle-layout.js';
import {
  HANDLE_FILL,
  OUTLINE_WIDTH_PX,
  SELECTION_COLOR,
  type OverlayRect,
} from '../select/overlay-rects.js';

/** An anchor marker's side, CSS px: the anchor a line end landed on. */
export const ANCHOR_MARKER_PX = 6;

/**
 * A square centred on a point, one screen size at every zoom.
 *
 * @param centre - The point, world units.
 * @param sidePx - The side, CSS px.
 * @param zoom - The camera zoom, CSS px per world unit.
 * @returns The square's box, world units.
 */
function squareAt(centre: Point, sidePx: number, zoom: number): OverlayRect['box'] {
  const side = sidePx / zoom;
  return { x: centre.x - side / 2, y: centre.y - side / 2, width: side, height: side, rotation: 0 };
}

/**
 * A line's endpoint handle: a square in the selection colour with a white
 * inside, the size of a resize handle, drawn on the end point. Pure.
 *
 * @param point - The end point, world units.
 * @param zoom - The camera zoom.
 * @returns The two squares, border first.
 */
export function endpointHandleRects(point: Point, zoom: number): OverlayRect[] {
  const inside = HANDLE_SIZE_PX - 2 * OUTLINE_WIDTH_PX;
  return [
    { box: squareAt(point, HANDLE_SIZE_PX, zoom), color: SELECTION_COLOR },
    { box: squareAt(point, inside, zoom), color: HANDLE_FILL },
  ];
}

/**
 * The marker on the anchor a line end landed on: a filled square in the selection colour, so
 * the person sees the end will sit on the object's centre or edge midpoint. Pure.
 *
 * @param anchor - The anchor, world units.
 * @param zoom - The camera zoom.
 * @returns The marker.
 */
export function anchorMarkerRect(anchor: Point, zoom: number): OverlayRect {
  return { box: squareAt(anchor, ANCHOR_MARKER_PX, zoom), color: SELECTION_COLOR };
}

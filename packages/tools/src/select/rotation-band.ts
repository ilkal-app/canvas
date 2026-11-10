import type { Point } from '@canvas/schema';

import { HANDLE_HIT_SIZE_PX, touchCornerOutwardReachPx } from './handle-layout.js';
import { worldPointToBox, type OrientedBox } from './oriented-box.js';
import type { SelectPointerType } from './select-input.js';

/**
 * How far the rotation band reaches beyond the corner handle's pickable square, CSS px,
 * whatever the zoom.
 */
export const ROTATION_BAND_WIDTH_PX = 12;

/**
 * How far the rotation band reaches beyond a finger's corner handle square, CSS px: the touch
 * handle square reaches 38 to 44 px out of the corner (`touchCornerOutwardReachPx`), and the band
 * runs 24 px beyond that, so a finger has a band as wide as a mouse's handle and band together.
 */
export const TOUCH_ROTATION_BAND_WIDTH_PX = 24;

/**
 * How far the rotation band reaches beyond the corner handle's pickable square for a kind of
 * pointer: {@link TOUCH_ROTATION_BAND_WIDTH_PX} for touch, {@link ROTATION_BAND_WIDTH_PX} for a
 * mouse or a pen.
 *
 * @param pointerType - The pointer; `mouse` if absent.
 * @returns The width, CSS px.
 */
export function rotationBandWidthPx(pointerType: SelectPointerType = 'mouse'): number {
  return pointerType === 'touch' ? TOUCH_ROTATION_BAND_WIDTH_PX : ROTATION_BAND_WIDTH_PX;
}

/** The selection frame's four corners, clockwise from its top-left, in the frame's own axes. */
export const SELECTION_CORNERS = ['nw', 'ne', 'se', 'sw'] as const;

/** One of {@link SELECTION_CORNERS}. */
export type SelectionCorner = (typeof SELECTION_CORNERS)[number];

/**
 * Where a corner sits along the frame's axes, and which way is out from it.
 *
 * @param frame - The selection frame.
 * @param corner - The corner.
 * @returns The corner's local position, world units, and `sx`, `sy`: −1 or +1, the outward
 *   direction along the frame's own x and y axes.
 */
function cornerOf(
  frame: OrientedBox,
  corner: SelectionCorner,
): { x: number; y: number; sx: number; sy: number } {
  switch (corner) {
    case 'nw':
      return { x: 0, y: 0, sx: -1, sy: -1 };
    case 'ne':
      return { x: frame.width, y: 0, sx: 1, sy: -1 };
    case 'se':
      return { x: frame.width, y: frame.height, sx: 1, sy: 1 };
    case 'sw':
      return { x: 0, y: frame.height, sx: -1, sy: 1 };
  }
}

/**
 * The corner whose rotation band holds a world point, if any (as in Figma's corner rotation). Each
 * band is a quarter ring outside one corner of the frame, turned with it: the quadrant beyond both
 * of the corner's edges, from the corner handle's pickable edge ({@link HANDLE_HIT_SIZE_PX} / 2
 * from the corner) to {@link ROTATION_BAND_WIDTH_PX} further out, both in CSS px divided by the
 * zoom, so the band keeps one screen size at every zoom; for a finger the band begins where the
 * finger's corner handle square ends, 38 to 44 px out (`touchCornerOutwardReachPx`), and is
 * `rotationBandWidthPx` wide. The bands never reach inside the frame. Where a corner handle's
 * square pokes past the ring's inner edge the handle wins; the press resolves handles first. Pure.
 *
 * @param frame - The selection frame, world units.
 * @param zoom - The camera zoom, CSS px per world unit; greater than 0.
 * @param point - The pointer, world units.
 * @param pointerType - The pointer, which sizes the band; `mouse` if absent.
 * @returns The corner, or undefined.
 */
export function hitRotationBand(
  frame: OrientedBox,
  zoom: number,
  point: Point,
  pointerType: SelectPointerType = 'mouse',
): SelectionCorner | undefined {
  const local = worldPointToBox(frame, point);
  const innerPx =
    pointerType === 'touch' ? touchCornerOutwardReachPx(frame, zoom) : HANDLE_HIT_SIZE_PX / 2;
  const inner = innerPx / zoom;
  const outer = inner + rotationBandWidthPx(pointerType) / zoom;
  return SELECTION_CORNERS.find((corner) => {
    const { x, y, sx, sy } = cornerOf(frame, corner);
    const dx = local.x - x;
    const dy = local.y - y;
    if (sx * dx < 0 || sy * dy < 0) return false;
    const distance = Math.hypot(dx, dy);
    return distance >= inner && distance <= outer;
  });
}

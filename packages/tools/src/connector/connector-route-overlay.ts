import type { Point } from '@canvas/schema';

import { boxPointToWorld, type OrientedBox } from '../select/oriented-box.js';
import {
  HANDLE_FILL,
  OUTLINE_WIDTH_PX,
  SELECTION_COLOR,
  type OverlayRect,
} from '../select/overlay-rects.js';

/** An elbow's middle-piece handle: a bar this long along the piece, CSS px. */
export const ELBOW_HANDLE_LENGTH_PX = 16;

/** An elbow's middle-piece handle: a bar this wide across the piece, CSS px. */
export const ELBOW_HANDLE_WIDTH_PX = 6;

/** A curve's bend handle: a round dot this wide, CSS px. */
export const CURVE_HANDLE_PX = 10;

/**
 * A rectangle centred on a point, turned by an angle, one screen size at every zoom.
 *
 * @param center - The centre, world units.
 * @param widthPx - Its width, CSS px.
 * @param heightPx - Its height, CSS px.
 * @param rotation - Its turn, radians.
 * @param zoom - The camera zoom.
 * @returns The box.
 */
function centredBox(
  center: Point,
  widthPx: number,
  heightPx: number,
  rotation: number,
  zoom: number,
): OrientedBox {
  const width = widthPx / zoom;
  const height = heightPx / zoom;
  const offset = boxPointToWorld(
    { x: 0, y: 0, width, height, rotation },
    { x: -width / 2, y: -height / 2 },
  );
  return { x: center.x + offset.x, y: center.y + offset.y, width, height, rotation };
}

/**
 * An elbow's middle-piece handle: a bar along the piece in the selection colour with a white
 * inside, {@link ELBOW_HANDLE_LENGTH_PX} by {@link ELBOW_HANDLE_WIDTH_PX}. Pure.
 *
 * @param center - Its centre, world units.
 * @param axis - The axis the piece moves along: `'x'` for an upright piece.
 * @param zoom - The camera zoom.
 * @returns The two rectangles, border first.
 */
export function elbowHandleRects(center: Point, axis: 'x' | 'y', zoom: number): OverlayRect[] {
  const inset = 2 * OUTLINE_WIDTH_PX;
  const [width, height] =
    axis === 'x'
      ? [ELBOW_HANDLE_WIDTH_PX, ELBOW_HANDLE_LENGTH_PX]
      : [ELBOW_HANDLE_LENGTH_PX, ELBOW_HANDLE_WIDTH_PX];
  return [
    { box: centredBox(center, width, height, 0, zoom), color: SELECTION_COLOR },
    { box: centredBox(center, width - inset, height - inset, 0, zoom), color: HANDLE_FILL },
  ];
}

/**
 * The height of each strip a curve's dot is drawn with, CSS px: a third, so no strip's edge falls
 * on a pixel's centre when the dot is centred on a whole pixel.
 */
const DOT_STRIP_PX = 1 / 3;

/**
 * A disc as horizontal strips, each as wide as the disc at the strip's middle: the overlay draws
 * rectangles only, and strips a third of a pixel tall draw a disc to the pixel.
 *
 * @param center - Its centre, world units.
 * @param radiusPx - Its radius, CSS px.
 * @param zoom - The camera zoom.
 * @param color - Its colour.
 * @returns The strips, top first.
 */
function discRects(
  center: Point,
  radiusPx: number,
  zoom: number,
  color: OverlayRect['color'],
): OverlayRect[] {
  const count = Math.round((2 * radiusPx) / DOT_STRIP_PX);
  return Array.from({ length: count }, (unused, index) => {
    const middle = -radiusPx + (index + 0.5) * DOT_STRIP_PX;
    const halfWidth = Math.sqrt(radiusPx * radiusPx - middle * middle);
    const strip = { x: center.x, y: center.y + middle / zoom };
    return { box: centredBox(strip, 2 * halfWidth, DOT_STRIP_PX, 0, zoom), color };
  });
}

/**
 * A curve's bend handle: a round dot {@link CURVE_HANDLE_PX} wide in the selection colour with a
 * white inside, each a disc of thin strips (the overlay draws rectangles only). Pure.
 *
 * @param center - Its centre, world units.
 * @param zoom - The camera zoom.
 * @returns The strips, the border's first.
 */
export function curveHandleRects(center: Point, zoom: number): OverlayRect[] {
  const radius = CURVE_HANDLE_PX / 2;
  return [
    ...discRects(center, radius, zoom, SELECTION_COLOR),
    ...discRects(center, radius - OUTLINE_WIDTH_PX, zoom, HANDLE_FILL),
  ];
}

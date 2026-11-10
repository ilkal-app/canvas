import type { Crop, Rgba } from '@canvas/schema';

import { handleLayout } from '../select/handle-layout.js';
import { boxPointToWorld, type OrientedBox } from '../select/oriented-box.js';
import {
  HANDLE_FILL,
  OUTLINE_WIDTH_PX,
  SELECTION_COLOR,
  type OverlayRect,
} from '../select/overlay-rects.js';

import { cropFrameOf, type CropHandle } from './crop-geometry.js';

/**
 * What dims the image outside the crop box while cropping: black at a half, so the whole image
 * shows through, darker than what the crop keeps.
 */
export const CROP_DIM_COLOR: Rgba = [0, 0, 0, 0.5];

/**
 * A rectangle in a box's own frame, placed on the board and turned with it.
 *
 * @param box - The box whose frame the rectangle is given in.
 * @param x - Left along the box's x axis, world units.
 * @param y - Top along its y axis, world units.
 * @param width - Width, world units.
 * @param height - Height, world units.
 * @returns The rectangle on the board.
 */
function inBox(box: OrientedBox, x: number, y: number, width: number, height: number): OrientedBox {
  return { ...boxPointToWorld(box, { x, y }), width, height, rotation: box.rotation };
}

/**
 * The four bands of the whole image around the crop, dimmed; a band of no size is left out.
 *
 * @param full - The whole image, world units.
 * @param crop - The crop, fractions of the natural size.
 * @returns The bands.
 */
function dimBandsOf(full: OrientedBox, crop: Crop): OverlayRect[] {
  const left = crop.x * full.width;
  const top = crop.y * full.height;
  const right = left + crop.width * full.width;
  const bottom = top + crop.height * full.height;
  const middle = bottom - top;
  return [
    inBox(full, 0, 0, full.width, top),
    inBox(full, 0, bottom, full.width, full.height - bottom),
    inBox(full, 0, top, left, middle),
    inBox(full, right, top, full.width - right, middle),
  ]
    .filter((band) => band.width > 0 && band.height > 0)
    .map((box) => ({ box, color: CROP_DIM_COLOR }));
}

/**
 * The crop box's outline: four strips just outside its edges, in the selection colour.
 *
 * @param crop - The crop box.
 * @param t - The strip width, world units.
 * @returns The strips.
 */
function outlineOf(crop: OrientedBox, t: number): OverlayRect[] {
  const { width, height } = crop;
  return [
    inBox(crop, -t, -t, width + 2 * t, t),
    inBox(crop, -t, height, width + 2 * t, t),
    inBox(crop, -t, 0, t, height),
    inBox(crop, width, 0, t, height),
  ].map((box) => ({ box, color: SELECTION_COLOR }));
}

/**
 * The crop box's eight handles, as the select tool draws its own: a square in the selection
 * colour with a white inside, turned with the image, one screen size at every zoom.
 *
 * @param crop - The crop box.
 * @param zoom - The camera zoom, CSS px per world unit.
 * @param focused - The handle the keyboard moves, drawn filled; none when it pans the box.
 * @returns Two rectangles per handle, one for the focused one.
 */
function handlesOf(crop: OrientedBox, zoom: number, focused?: CropHandle): OverlayRect[] {
  const border = OUTLINE_WIDTH_PX / zoom;
  return handleLayout(crop, zoom, true).flatMap(({ handle, centre, size }) =>
    // The focused handle is drawn filled, so the keyboard's focus shows.
    (handle === focused ? [0] : [0, border]).map((inset) => {
      const side = size - 2 * inset;
      const corner = boxPointToWorld(
        { ...crop, x: centre.x, y: centre.y },
        {
          x: -side / 2,
          y: -side / 2,
        },
      );
      return {
        box: { ...corner, width: side, height: side, rotation: crop.rotation },
        color: inset === 0 ? SELECTION_COLOR : HANDLE_FILL,
      };
    }),
  );
}

/**
 * What the crop mode draws over the image: the whole image
 * outside the crop box dimmed, the crop box outlined, and its eight handles, all turned with
 * the image; lines and handles keep one screen size at every zoom. Pure.
 *
 * @param full - The whole image (`fullImageFrame`), world units.
 * @param crop - The crop, fractions of the natural size.
 * @param zoom - The camera zoom, CSS px per world unit.
 * @param focused - The handle the keyboard moves (drawn filled), if any.
 * @returns The rectangles, bottom first.
 */
export function cropOverlayRects(
  full: OrientedBox,
  crop: Crop,
  zoom: number,
  focused?: CropHandle,
): OverlayRect[] {
  const box = cropFrameOf(full, crop);
  return [
    ...dimBandsOf(full, crop),
    ...outlineOf(box, OUTLINE_WIDTH_PX / zoom),
    ...handlesOf(box, zoom, focused),
  ];
}

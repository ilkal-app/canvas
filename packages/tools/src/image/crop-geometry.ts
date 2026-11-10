import { fullImageBox, type CroppedImage } from '@canvas/document';
import type { Crop, Point } from '@canvas/schema';

import type { ResizeHandle } from '../select/handle-layout.js';
import { boxPointToWorld, type OrientedBox } from '../select/oriented-box.js';

/**
 * What a crop drag moves: one of the crop box's eight handles,
 * which moves its edges, or the box itself (`inside`), which pans the crop over the image.
 */
export type CropHandle = ResizeHandle | 'inside';

/** The smallest side a crop can be dragged to, CSS px on screen at the zoom of the drag. */
export const MIN_CROP_SIDE_PX = 16;

/** A pointer's movement as fractions of the image's natural width and height. */
export interface CropDelta {
  /** Across, a fraction of the natural width. */
  readonly x: number;
  /** Down, a fraction of the natural height. */
  readonly y: number;
}

/** The smallest crop, as fractions of the natural width and height. */
export interface CropMinimum {
  /** Width, a fraction of the natural width, greater than 0. */
  readonly width: number;
  /** Height, a fraction of the natural height, greater than 0. */
  readonly height: number;
}

/**
 * The whole source image on the board: the image's box, grown by what the crop hides, turned
 * with it (the crop mode shows it dimmed around the crop box). Pure.
 *
 * @param imageFrame - The image's box on the board (`orientedBoxOf`), world units.
 * @param image - The image's size and crop as stored.
 * @returns The whole image, world units.
 */
export function fullImageFrame(imageFrame: OrientedBox, image: CroppedImage): OrientedBox {
  const full = fullImageBox(image);
  const corner = boxPointToWorld(imageFrame, { x: full.x, y: full.y });
  return { ...corner, width: full.width, height: full.height, rotation: imageFrame.rotation };
}

/**
 * The crop box on the board: a crop's rectangle of the whole image. Pure.
 *
 * @param full - The whole image (`fullImageFrame`), world units.
 * @param crop - The crop, fractions of the natural size.
 * @returns The crop box, world units, turned with the image.
 */
export function cropFrameOf(full: OrientedBox, crop: Crop): OrientedBox {
  const corner = boxPointToWorld(full, { x: crop.x * full.width, y: crop.y * full.height });
  return {
    ...corner,
    width: crop.width * full.width,
    height: crop.height * full.height,
    rotation: full.rotation,
  };
}

/**
 * A pointer's movement across the whole image as fractions of its natural size. Pure.
 *
 * @param full - The whole image, world units.
 * @param from - Where the drag started, in the whole image's own frame, world units.
 * @param to - Where the pointer is now, in the same frame.
 * @returns The movement, fractions.
 */
export function cropDeltaOf(full: OrientedBox, from: Point, to: Point): CropDelta {
  return { x: (to.x - from.x) / full.width, y: (to.y - from.y) / full.height };
}

/**
 * Keeps a value inside a range.
 *
 * @param value - The value.
 * @param low - The smallest allowed.
 * @param high - The largest allowed, at least `low`.
 * @returns The value, clamped.
 */
function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * The crop after a drag of one of its handles (crop box maths in natural-size fractions): a handle
 * moves the edges it sits on by the pointer's movement, stopping at the image's edges and at the
 * smallest crop (never smaller than the crop the drag started from); the box pans the crop over
 * the image, stopping at its edges. The result always lies inside the unit square and is never
 * empty. Pure.
 *
 * @param start - The crop when the drag started.
 * @param handle - What is dragged.
 * @param delta - The pointer's movement since the drag started, fractions.
 * @param minimum - The smallest crop, fractions.
 * @returns The new crop.
 */
export function dragCrop(
  start: Crop,
  handle: CropHandle,
  delta: CropDelta,
  minimum: CropMinimum,
): Crop {
  if (handle === 'inside') {
    return {
      ...start,
      x: clamp(start.x + delta.x, 0, 1 - start.width),
      y: clamp(start.y + delta.y, 0, 1 - start.height),
    };
  }
  const minWidth = Math.min(minimum.width, start.width);
  const minHeight = Math.min(minimum.height, start.height);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left = clamp(left + delta.x, 0, right - minWidth);
  if (handle.includes('e')) right = clamp(right + delta.x, left + minWidth, 1);
  if (handle.includes('n')) top = clamp(top + delta.y, 0, bottom - minHeight);
  if (handle.includes('s')) bottom = clamp(bottom + delta.y, top + minHeight, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Whether two crops are the same rectangle.
 *
 * @param first - One crop.
 * @param second - The other.
 * @returns True when every field is equal.
 */
export function isSameCrop(first: Crop, second: Crop): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

import type { ImagePaint } from '../fields/paint.js';
import type { Crop } from '../objects/image-object.js';

import { croppedImageAspect, fittedImageRect, IMAGE_FIT_TOLERANCE } from './image-fit.js';
import type { Rect } from './local-bounds.js';

// How an image paint lays its image into an object's box: the one
// statement of the four fits, which the engine's records, its level selection, hit tests and the
// tests share.

/** How the drawn rectangle of an image paint is sampled. */
export type ImagePaintMode = 'clamp' | 'letterbox' | 'repeat';

/** Where an image paint draws in an object's box, and which part of the image it shows there. */
export interface ImagePaintLayout {
  /**
   * The rectangle one copy of the image's crop covers, in the box's own frame, world units: the
   * box (`fill`, `crop`), the fitted rectangle inside it (`fit`), or one tile from the box's
   * top-left corner (`tile`).
   */
  readonly drawn: Rect;
  /** The part of the image shown across `drawn`, fractions of its natural size. */
  readonly crop: Crop;
  /**
   * How `drawn` is sampled: `clamp` fills the box, `letterbox` leaves the box outside `drawn`
   * unpainted, `repeat` repeats `drawn` across the box.
   */
  readonly mode: ImagePaintMode;
}

/** What {@link imagePaintLayout} reads of an image paint. */
export type LaidOutImagePaint = Pick<ImagePaint, 'fit' | 'crop' | 'naturalSize'>;

/**
 * The part of a crop that covers a box of another aspect, centred: the crop cut along its longer
 * relative side so its aspect is the box's. A box within {@link IMAGE_FIT_TOLERANCE} of the crop's
 * aspect keeps the whole crop. Pure.
 *
 * @param paint - The crop and natural size.
 * @param box - The box's size, world units.
 * @param box.width - Its width.
 * @param box.height - Its height.
 * @returns The covering crop.
 */
function coverCrop(
  paint: Pick<ImagePaint, 'crop' | 'naturalSize'>,
  box: { readonly width: number; readonly height: number },
): Crop {
  const { crop } = paint;
  const regionAspect = croppedImageAspect(paint);
  const boxAspect = box.width / box.height;
  if (!(boxAspect > 0) || !(regionAspect > 0)) return crop;
  if (Math.abs(boxAspect / regionAspect - 1) <= IMAGE_FIT_TOLERANCE) return crop;
  if (boxAspect > regionAspect) {
    // The box is wider: the whole crop's width, a centred band of its height.
    const height = (crop.height * regionAspect) / boxAspect;
    return { ...crop, y: crop.y + (crop.height - height) / 2, height };
  }
  const width = (crop.width * boxAspect) / regionAspect;
  return { ...crop, x: crop.x + (crop.width - width) / 2, width };
}

/**
 * Lays an image paint into a box:
 *
 * - `fill` stretches the crop across the whole box;
 * - `fit` shows the whole crop at its own aspect, as large as fits, centred (`fittedImageRect`),
 *   leaving the rest of the box unpainted;
 * - `crop` covers the whole box at the crop's aspect, centred, cutting what overflows;
 * - `tile` repeats the crop at its natural size, one image pixel to one world unit, from the
 *   box's top-left corner, so a larger box shows more tiles and zooming scales them.
 *
 * Pure; the inputs are not mutated.
 *
 * @param paint - The paint's fit, crop and natural size.
 * @param box - The box's size, world units.
 * @param box.width - Its width.
 * @param box.height - Its height.
 * @returns Where it draws and what it shows.
 */
export function imagePaintLayout(
  paint: LaidOutImagePaint,
  box: { readonly width: number; readonly height: number },
): ImagePaintLayout {
  const { width, height } = box;
  switch (paint.fit) {
    case 'fill':
      return { drawn: { x: 0, y: 0, width, height }, crop: paint.crop, mode: 'clamp' };
    case 'fit':
      return {
        drawn: fittedImageRect({ width, height, crop: paint.crop, naturalSize: paint.naturalSize }),
        crop: paint.crop,
        mode: 'letterbox',
      };
    case 'crop':
      return {
        drawn: { x: 0, y: 0, width, height },
        crop: coverCrop(paint, box),
        mode: 'clamp',
      };
    case 'tile':
      return {
        drawn: {
          x: 0,
          y: 0,
          width: paint.crop.width * paint.naturalSize.width,
          height: paint.crop.height * paint.naturalSize.height,
        },
        crop: paint.crop,
        mode: 'repeat',
      };
  }
}

/** A point of an image, as fractions of its natural size (0 to 1 across and down). */
export interface ImagePaintPoint {
  /** Across, from the image's left edge. */
  readonly x: number;
  /** Down, from the image's top edge. */
  readonly y: number;
}

/**
 * Where a point of an object's box falls in the image an image paint shows: fractions of the
 * image's natural size, or `null` where the paint draws nothing (outside a `fit` letterbox). The
 * reference the engine's shader matches. Pure.
 *
 * @param paint - The paint's fit, crop and natural size.
 * @param box - The box's size, world units.
 * @param box.width - Its width.
 * @param box.height - Its height.
 * @param u - The point's x as a fraction of the box.
 * @param v - The point's y as a fraction of the box.
 * @returns The point in the image, or null.
 */
export function imagePaintPointAt(
  paint: LaidOutImagePaint,
  box: { readonly width: number; readonly height: number },
  u: number,
  v: number,
): ImagePaintPoint | null {
  const { drawn, crop, mode } = imagePaintLayout(paint, box);
  const across = (box.width * u - drawn.x) / drawn.width;
  const down = (box.height * v - drawn.y) / drawn.height;
  if (!Number.isFinite(across) || !Number.isFinite(down)) return null;
  if (mode === 'letterbox' && (across < 0 || across > 1 || down < 0 || down > 1)) return null;
  const wrap = (t: number): number =>
    mode === 'repeat' ? t - Math.floor(t) : Math.min(1, Math.max(0, t));
  return { x: crop.x + wrap(across) * crop.width, y: crop.y + wrap(down) * crop.height };
}

/**
 * The whole image's rectangle in an object's box (its own frame, box units) for an image paint:
 * where the image would lie if nothing cut it, placed so the paint's effective crop
 * (`imagePaintLayout`'s, the cover cut for `crop`) lands on the drawn rectangle; for `tile`, the
 * whole image behind the first tile at the box's top-left. Fill crop mode shows it around the
 * object. Pure.
 *
 * @param paint - The paint's fit, crop and natural size.
 * @param box - The object's box size.
 * @param box.width - Its width.
 * @param box.height - Its height.
 * @returns The whole image's rectangle, box units.
 */
export function imagePaintImageFrame(
  paint: LaidOutImagePaint,
  box: { readonly width: number; readonly height: number },
): Rect {
  const { drawn, crop } = imagePaintLayout(paint, box);
  const width = drawn.width / crop.width;
  const height = drawn.height / crop.height;
  return { x: drawn.x - crop.x * width, y: drawn.y - crop.y * height, width, height };
}

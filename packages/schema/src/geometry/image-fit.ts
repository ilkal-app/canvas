import type { ImageObject } from '../objects/image-object.js';

import type { Rect } from './local-bounds.js';

/**
 * How far, as a fraction, an image's box aspect may differ from its crop's before the image is
 * fitted inside the box rather than filling it: a thousandth, under a pixel at 800 px, so a box
 * that rounding moved off the crop's aspect still fills it.
 */
export const IMAGE_FIT_TOLERANCE = 1e-3;

/** What {@link fittedImageRect} reads of an image. */
export type FittedImage = Pick<ImageObject, 'width' | 'height' | 'crop' | 'naturalSize'>;

/**
 * The aspect, width over height, an image draws at: its cropped region's, `crop.width ×
 * naturalSize.width` over `crop.height × naturalSize.height`. A box of this aspect is
 * filled; the select tool keeps it when it resizes the image proportionally. Not finite (or not
 * positive) for an empty crop or size. Pure.
 *
 * @param image - The image's crop and natural size.
 * @returns The aspect.
 */
export function croppedImageAspect(image: Pick<ImageObject, 'crop' | 'naturalSize'>): number {
  const { crop, naturalSize } = image;
  return (crop.width * naturalSize.width) / (crop.height * naturalSize.height);
}

/**
 * Where an image draws inside its box: the cropped
 * region at its own aspect (`crop.width × naturalSize.width` by `crop.height ×
 * naturalSize.height`), as large as fits in the box, centred. A box whose aspect matches the
 * crop's (within {@link IMAGE_FIT_TOLERANCE}) is filled exactly. An image is never drawn
 * stretched, whatever box a merge left it with: the style group (crop) and the size group (box)
 * are written apart, so a crop concurrent with a restyle or a resize can pair one client's crop
 * with the other's box, and the drawing, not the stored layout, absorbs the mismatch. The
 * renderer draws here, hit tests pick here and crop mode measures the whole image from here;
 * the selection frame stays the stored box. Pure.
 *
 * @param image - The image's box (world units), crop and natural size.
 * @returns The drawn rectangle in the image's own frame, world units.
 */
export function fittedImageRect(image: FittedImage): Rect {
  const { width, height } = image;
  const regionAspect = croppedImageAspect(image);
  const boxAspect = width / height;
  if (!(boxAspect > 0) || Math.abs(boxAspect / regionAspect - 1) <= IMAGE_FIT_TOLERANCE) {
    return { x: 0, y: 0, width, height };
  }
  if (boxAspect > regionAspect) {
    const fittedWidth = height * regionAspect;
    return { x: (width - fittedWidth) / 2, y: 0, width: fittedWidth, height };
  }
  const fittedHeight = width / regionAspect;
  return { x: 0, y: (height - fittedHeight) / 2, width, height: fittedHeight };
}

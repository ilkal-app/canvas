import { fittedImageRect, type Crop, type ImageObject } from '@canvas/schema';

/** A box in an image's parent frame (or its own, for {@link fullImageBox}), world units. */
export interface ImageBox {
  /** The left edge (the origin's x), world units. */
  readonly x: number;
  /** The top edge (the origin's y), world units. */
  readonly y: number;
  /** Width, world units. */
  readonly width: number;
  /** Height, world units. */
  readonly height: number;
}

/** What the crop arithmetic reads of an image. */
export type CroppedImage = Pick<
  ImageObject,
  'x' | 'y' | 'rotation' | 'width' | 'height' | 'crop' | 'naturalSize'
>;

/**
 * The whole source image in the image object's own frame: the
 * crop is drawn where `fittedImageRect` puts it (the box itself, unless a merge left the box off
 * the crop's aspect), so the image extends past that by the uncropped fractions, at its scale.
 * Pure.
 *
 * @param image - The image object.
 * @returns The whole image, world units in the object's frame (the box is (0, 0, width, height)).
 */
export function fullImageBox(image: CroppedImage): ImageBox {
  const drawn = fittedImageRect(image);
  const width = drawn.width / image.crop.width;
  const height = drawn.height / image.crop.height;
  // `… - …`, not `-…`, so an uncropped edge of a filled box is 0 rather than −0.
  return { x: drawn.x - image.crop.x * width, y: drawn.y - image.crop.y * height, width, height };
}

/**
 * The box an image takes for a new crop, so the part of the image it still shows stays where it
 * was on the board at the same scale (world units per image fraction): cropping the left edge
 * in moves the box's left edge in, and a whole-image crop grows the box back to the whole
 * image. The origin moves along the image's turned axes, so a rotated image crops in place.
 * Measured from where the image is drawn (`fullImageBox`), so the new box always has the new
 * crop's aspect, even when a merge had left the old box off the old crop's.
 * `setStyle` writes it with the crop, in one transaction. Pure.
 *
 * @param image - The image object as it is.
 * @param crop - The new crop, fractions of the natural size.
 * @returns The new origin and size, in the image's parent frame.
 */
export function croppedImageBox(image: CroppedImage, crop: Crop): ImageBox {
  const full = fullImageBox(image);
  const left = full.x + crop.x * full.width;
  const top = full.y + crop.y * full.height;
  const cos = Math.cos(image.rotation);
  const sin = Math.sin(image.rotation);
  return {
    x: image.x + cos * left - sin * top,
    y: image.y + sin * left + cos * top,
    width: crop.width * full.width,
    height: crop.height * full.height,
  };
}

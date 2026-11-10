import type { Crop } from '@canvas/schema';

/** A width and a height, any units: a box or a picture's natural size. */
export interface CoverCropSize {
  /** The width. */
  readonly width: number;
  /** The height. */
  readonly height: number;
}

/**
 * The crop that fills a box with an image without stretching it, centred: the whole image when
 * their shapes match, else its middle part, cut on the sides or top and bottom; the whole image
 * for a box with no width or no height, which shows nothing (a resize may leave one so). Pure.
 *
 * @param box - The box shown, any units.
 * @param natural - The image's size, px.
 * @returns The crop, in fractions of the image.
 */
export function coverCrop(box: CoverCropSize, natural: CoverCropSize): Crop {
  // Such a box's aspect is 0, infinite or NaN, and a cut by it would be 0 wide or NaN, a crop
  // the schema refuses (the nightly sync fuzz refused an honest replaceImage so).
  if (!(box.width > 0 && box.height > 0)) return { x: 0, y: 0, width: 1, height: 1 };
  const boxAspect = box.width / box.height;
  const imageAspect = natural.width / natural.height;
  if (imageAspect > boxAspect) {
    const width = boxAspect / imageAspect;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = imageAspect / boxAspect;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

/**
 * The crop an image keeps when its picture is replaced: its own crop when, read as
 * fractions of the new picture, it still shows the box's shape (within 1%), so a chosen framing
 * survives a like-for-like swap; else the new picture's centred cover crop of the box.
 *
 * @param crop - The crop now.
 * @param box - The image's box, world units.
 * @param natural - The new picture's size, px.
 * @returns The crop.
 */
export function replacedCrop(crop: Crop, box: CoverCropSize, natural: CoverCropSize): Crop {
  const boxAspect = box.width / box.height;
  const shown = (crop.width * natural.width) / (crop.height * natural.height);
  return Math.abs(shown - boxAspect) <= boxAspect * 0.01 ? crop : coverCrop(box, natural);
}

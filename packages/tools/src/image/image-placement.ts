import type { NewObject } from '@canvas/document';
import type { AssetId, ImageObject, Point } from '@canvas/schema';

/** The longest edge of an image placed on the board (dropped, pasted or picked), world units. */
export const IMAGE_MAX_EDGE = 800;

/** The gap between images placed side by side in one drop, paste or pick, world units. */
export const IMAGE_ROW_GAP = 16;

/** An image to place: the asset it shows and the size of its original, px. */
export interface PlacedImage {
  /** The asset (the SHA-256 of the original). */
  readonly assetId: AssetId;
  /** The original's upright size, px. */
  readonly naturalSize: ImageObject['naturalSize'];
}

/** A width and height, world units. */
export interface BoxSize {
  /** Width, world units. */
  readonly width: number;
  /** Height, world units. */
  readonly height: number;
}

/**
 * The box a placed image takes: its natural aspect ratio, one
 * world unit per pixel up to a long edge of {@link IMAGE_MAX_EDGE}, scaled down to it beyond.
 * Pure.
 *
 * @param naturalSize - The original's size, px.
 * @returns The box's size, world units.
 */
export function imageBoxSize(naturalSize: ImageObject['naturalSize']): BoxSize {
  const { width, height } = naturalSize;
  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(width, height));
  return { width: width * scale, height: height * scale };
}

/**
 * The image object a placed image becomes: {@link imageBoxSize} centred on a point, uncropped
 * and opaque, at the board root. Pure.
 *
 * @param image - The asset and its natural size.
 * @param centre - Where its centre goes, world units.
 * @returns The object, as `createObjects` lists it.
 */
export function newImageObject(image: PlacedImage, centre: Point): NewObject {
  const size = imageBoxSize(image.naturalSize);
  return {
    type: 'image',
    parentId: null,
    x: centre.x - size.width / 2,
    y: centre.y - size.height / 2,
    rotation: 0,
    locked: false,
    ...size,
    assetId: image.assetId,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    naturalSize: { ...image.naturalSize },
    opacity: 1,
  };
}

/**
 * Places several images at once (a drop or pick of several files): side by side in one row,
 * {@link IMAGE_ROW_GAP} apart, vertically centred, the row centred on the point; one image is
 * centred on it. Pure.
 *
 * @param images - The images, left to right.
 * @param at - Where the row's centre goes, world units.
 * @returns The objects, in the same order.
 */
export function placeImages(images: readonly PlacedImage[], at: Point): NewObject[] {
  const placed = images.map((image) => ({ image, size: imageBoxSize(image.naturalSize) }));
  const rowWidth =
    placed.reduce((sum, { size }) => sum + size.width, 0) +
    IMAGE_ROW_GAP * Math.max(0, images.length - 1);
  let left = at.x - rowWidth / 2;
  return placed.map(({ image, size }) => {
    const object = newImageObject(image, { x: left + size.width / 2, y: at.y });
    left += size.width + IMAGE_ROW_GAP;
    return object;
  });
}

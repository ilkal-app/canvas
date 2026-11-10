import { imagePaintLayout, type ImageObject, type ImagePaint, type ObjectId } from '@canvas/schema';

// What the texture manager tracks: an image object as it is, or, since
// The image of a shape's or frame's image paint as one. Both share
// the manager's index, level selection, budget and "smallest level always resident" rule.

/**
 * An image the texture manager keeps levels resident for: its asset, natural size, the box it
 * draws across (world units) and the part of the image shown there. An `ImageObject` is one as
 * it is; an image paint's (`type: 'image-paint'`) has the box and crop its fit lays it into, so
 * level selection asks for the resolution the fill draws at.
 */
export interface ResidencyImage extends Pick<
  ImageObject,
  'id' | 'assetId' | 'width' | 'height' | 'crop' | 'naturalSize'
> {
  /** `'image'` for an image object, `'image-paint'` for a shape's or frame's image paint. */
  readonly type: 'image' | 'image-paint';
}

/**
 * The image an image paint draws, as the texture manager tracks it: the rectangle one copy of the
 * crop covers (`imagePaintLayout`'s `drawn`; for `tile`, one tile) and the crop it shows there,
 * so the level it wants is the one the fill draws at. Pure.
 *
 * @param id - The shape or frame.
 * @param paint - Its image paint.
 * @param box - Its box, world units.
 * @param box.width - The width.
 * @param box.height - The height.
 * @returns The residency image.
 */
export function paintResidencyImage(
  id: ObjectId,
  paint: ImagePaint,
  box: { readonly width: number; readonly height: number },
): ResidencyImage {
  const { drawn, crop } = imagePaintLayout(paint, box);
  return {
    type: 'image-paint',
    id,
    assetId: paint.assetId,
    naturalSize: paint.naturalSize,
    width: drawn.width,
    height: drawn.height,
    crop,
  };
}

/**
 * Tells whether an image may be drawn from tiles of a large original: an image object may, an
 * image paint never (fills draw from pyramid levels, at most 4096 px).
 *
 * @param image - The image.
 * @returns True for an image object.
 */
export function isTileable(image: ResidencyImage): boolean {
  return image.type === 'image';
}

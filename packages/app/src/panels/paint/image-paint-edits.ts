import { isImagePaint, type ImageFit, type ImagePaint, type Paint } from '@canvas/schema';

import type { ReplacementAsset } from '../../assets/page-images.js';

/** The fits the Image kind offers, in the schema's order (`imageFitSchema`). */
export const IMAGE_FITS: readonly ImageFit[] = ['fill', 'fit', 'crop', 'tile'];

/** A new image fill's fit: it covers the box, cut centred, never stretched. */
const DEFAULT_IMAGE_FIT: ImageFit = 'crop';

/**
 * The image fill a chosen image gives a target: the whole image, in the target's own
 * fit when it already has an image fill (a replaced image keeps how it is laid), else covering
 * the box (`crop`). Pure.
 *
 * @param asset - The image chosen, as `PageImages.replace` gives it.
 * @param own - The target's paint now.
 * @returns The image fill.
 */
export function imagePaintFrom(asset: ReplacementAsset, own: Paint | null): ImagePaint {
  return {
    type: 'image',
    assetId: asset.assetId,
    naturalSize: { width: asset.naturalSize.width, height: asset.naturalSize.height },
    fit: isImagePaint(own) ? own.fit : DEFAULT_IMAGE_FIT,
    crop: { x: 0, y: 0, width: 1, height: 1 },
  };
}

/**
 * A paint with an image fill's fit set: any other paint, or one already in that fit,
 * is returned as is, so a mixed selection's other targets are left alone. Pure.
 *
 * @param paint - The target's paint now.
 * @param fit - The fit chosen.
 * @returns The paint.
 */
export function withImageFit(paint: Paint | null, fit: ImageFit): Paint | null {
  return isImagePaint(paint) && paint.fit !== fit ? { ...paint, fit } : paint;
}

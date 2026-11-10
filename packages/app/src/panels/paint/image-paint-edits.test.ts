// PR 3: the pure edits behind the paint control's Image kind.
import { describe, expect, it } from 'vitest';

import { paintSchema, type AssetId, type ImagePaint, type Paint } from '@canvas/schema';

import { IMAGE_FITS, imagePaintFrom, withImageFit } from './image-paint-edits.js';

const asset = { assetId: 'asset-new' as AssetId, naturalSize: { width: 1600, height: 900 } };

const tiled: ImagePaint = {
  type: 'image',
  assetId: 'asset-old' as AssetId,
  naturalSize: { width: 100, height: 80 },
  fit: 'tile',
  crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
};

describe('imagePaintFrom', () => {
  it.each<[string, Paint | null]>([
    ['none', null],
    ['a colour', [1, 0, 0, 1]],
    ['a gradient', { type: 'linear', angle: 0, stops: [] }],
  ])('makes a whole-image crop fill from %s, valid for the schema', (unused, own) => {
    const paint = imagePaintFrom(asset, own);
    expect(paint).toEqual({
      type: 'image',
      assetId: 'asset-new',
      naturalSize: { width: 1600, height: 900 },
      fit: 'crop',
      crop: { x: 0, y: 0, width: 1, height: 1 },
    });
    expect(paintSchema.safeParse(paint).success).toBe(true);
  });

  it('keeps an image fill’s fit and starts the new image whole', () => {
    expect(imagePaintFrom(asset, tiled)).toEqual({
      ...tiled,
      assetId: 'asset-new',
      naturalSize: { width: 1600, height: 900 },
      crop: { x: 0, y: 0, width: 1, height: 1 },
    });
  });

  it('copies the natural size rather than sharing it', () => {
    expect(imagePaintFrom(asset, null).naturalSize).not.toBe(asset.naturalSize);
  });
});

describe('withImageFit', () => {
  it('sets each fit on an image fill and leaves the rest of it alone', () => {
    for (const fit of IMAGE_FITS) {
      expect(withImageFit(tiled, fit)).toEqual({ ...tiled, fit });
    }
  });

  it('returns the very paint when it already has the fit, or is no image', () => {
    expect(withImageFit(tiled, 'tile')).toBe(tiled);
    const colour: Paint = [0, 0, 1, 1];
    expect(withImageFit(colour, 'fit')).toBe(colour);
    expect(withImageFit(null, 'fit')).toBeNull();
  });

  it('offers the four fits in the schema’s order', () => {
    expect(IMAGE_FITS).toEqual(['fill', 'fit', 'crop', 'tile']);
  });
});

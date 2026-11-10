import { describe, expect, it } from 'vitest';

import { newObjectSchema } from '@canvas/document';
import type { AssetId } from '@canvas/schema';

import {
  IMAGE_MAX_EDGE,
  IMAGE_ROW_GAP,
  imageBoxSize,
  newImageObject,
  placeImages,
} from './image-placement.js';

const PHOTO = { assetId: 'a'.repeat(64) as AssetId, naturalSize: { width: 4000, height: 3000 } };
const ICON = { assetId: 'b'.repeat(64) as AssetId, naturalSize: { width: 100, height: 50 } };

describe('imageBoxSize', () => {
  it('keeps the natural aspect ratio with the long edge at most 800 world units', () => {
    expect(imageBoxSize({ width: 4000, height: 3000 })).toEqual({ width: 800, height: 600 });
    expect(imageBoxSize({ width: 900, height: 3000 })).toEqual({ width: 240, height: 800 });
  });

  it('keeps a small image at one world unit per pixel', () => {
    expect(imageBoxSize({ width: 100, height: 50 })).toEqual({ width: 100, height: 50 });
    expect(imageBoxSize({ width: IMAGE_MAX_EDGE, height: 1 })).toEqual({ width: 800, height: 1 });
  });
});

describe('newImageObject', () => {
  it('centres an uncropped, opaque image on the point, valid for createObjects', () => {
    const object = newImageObject(PHOTO, { x: 100, y: 50 });
    expect(object).toEqual({
      type: 'image',
      parentId: null,
      x: -300,
      y: -250,
      rotation: 0,
      locked: false,
      width: 800,
      height: 600,
      assetId: PHOTO.assetId,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      naturalSize: { width: 4000, height: 3000 },
      opacity: 1,
    });
    expect(newObjectSchema.safeParse(object).success).toBe(true);
  });
});

describe('placeImages', () => {
  it('centres one image on the point', () => {
    expect(placeImages([ICON], { x: 0, y: 0 })).toEqual([newImageObject(ICON, { x: 0, y: 0 })]);
  });

  it('lays several images in a row centred on the point, a gap apart', () => {
    const [first, second] = placeImages([PHOTO, ICON], { x: 0, y: 0 });
    const rowWidth = 800 + IMAGE_ROW_GAP + 100;
    expect(first).toMatchObject({ x: -rowWidth / 2, y: -300, width: 800 });
    expect(second).toMatchObject({ x: -rowWidth / 2 + 800 + IMAGE_ROW_GAP, y: -25, width: 100 });
  });

  it('places nothing for no images', () => {
    expect(placeImages([], { x: 0, y: 0 })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { cropSchema, type Crop } from '@canvas/schema';

import {
  cropDeltaOf,
  cropFrameOf,
  dragCrop,
  fullImageFrame,
  isSameCrop,
  type CropHandle,
} from './crop-geometry.js';

const HALF: Crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
const TINY = { width: 0.1, height: 0.1 };

describe('fullImageFrame and cropFrameOf', () => {
  const image = {
    x: 100,
    y: 0,
    rotation: 0,
    width: 200,
    height: 100,
    crop: { x: 0.25, y: 0.5, width: 0.5, height: 0.5 },
    naturalSize: { width: 4000, height: 2000 },
  };

  it('grows the image box by what the crop hides, and puts the crop box back on it', () => {
    const frame = { x: 100, y: 0, width: 200, height: 100, rotation: 0 };
    const full = fullImageFrame(frame, image);
    expect(full).toEqual({ x: 0, y: -100, width: 400, height: 200, rotation: 0 });
    expect(cropFrameOf(full, image.crop)).toEqual(frame);
  });

  it('measures the whole image from where a box off the crop’s aspect draws it', () => {
    // A 300 × 100 box draws the 2:1 crop 200 × 100 from x = 50 (fitted, not stretched).
    const frame = { x: 100, y: 0, width: 300, height: 100, rotation: 0 };
    const full = fullImageFrame(frame, { ...image, width: 300 });
    expect(full).toEqual({ x: 50, y: -100, width: 400, height: 200, rotation: 0 });
  });

  it('turns the whole image with a rotated image', () => {
    const frame = { x: 0, y: 0, width: 200, height: 100, rotation: Math.PI / 2 };
    const full = fullImageFrame(frame, image);
    // 100 left and 100 up in the image's frame is 100 right and 100 up on the board.
    expect(full.x).toBeCloseTo(100);
    expect(full.y).toBeCloseTo(-100);
    expect(full).toMatchObject({ width: 400, height: 200, rotation: Math.PI / 2 });
  });
});

describe('cropDeltaOf', () => {
  it('measures a movement in fractions of the whole image', () => {
    const full = { x: 0, y: 0, width: 400, height: 200, rotation: 0 };
    expect(cropDeltaOf(full, { x: 10, y: 10 }, { x: 110, y: 60 })).toEqual({ x: 0.25, y: 0.25 });
  });
});

describe('dragCrop', () => {
  const cases: readonly (readonly [CropHandle, Crop])[] = [
    ['nw', { x: 0.35, y: 0.35, width: 0.4, height: 0.4 }],
    ['ne', { x: 0.25, y: 0.35, width: 0.6, height: 0.4 }],
    ['se', { x: 0.25, y: 0.25, width: 0.6, height: 0.6 }],
    ['sw', { x: 0.35, y: 0.25, width: 0.4, height: 0.6 }],
    ['n', { x: 0.25, y: 0.35, width: 0.5, height: 0.4 }],
    ['e', { x: 0.25, y: 0.25, width: 0.6, height: 0.5 }],
    ['s', { x: 0.25, y: 0.25, width: 0.5, height: 0.6 }],
    ['w', { x: 0.35, y: 0.25, width: 0.4, height: 0.5 }],
    ['inside', { x: 0.35, y: 0.35, width: 0.5, height: 0.5 }],
  ];

  it.each(cases)('moves the edges the %s handle sits on', (handle, expected) => {
    const crop = dragCrop(HALF, handle, { x: 0.1, y: 0.1 }, TINY);
    expect(crop.x).toBeCloseTo(expected.x);
    expect(crop.y).toBeCloseTo(expected.y);
    expect(crop.width).toBeCloseTo(expected.width);
    expect(crop.height).toBeCloseTo(expected.height);
  });

  it('stops edges at the image and panning at its edges', () => {
    expect(dragCrop(HALF, 'nw', { x: -1, y: -1 }, TINY)).toEqual({
      x: 0,
      y: 0,
      width: 0.75,
      height: 0.75,
    });
    expect(dragCrop(HALF, 'se', { x: 1, y: 1 }, TINY)).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.75,
      height: 0.75,
    });
    expect(dragCrop(HALF, 'inside', { x: 1, y: -1 }, TINY)).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
  });

  it('stops at the smallest crop, and never below the crop the drag started from', () => {
    const shrunk = dragCrop(HALF, 'se', { x: -1, y: -1 }, TINY);
    expect(shrunk.width).toBeCloseTo(0.1);
    expect(shrunk.height).toBeCloseTo(0.1);
    const small = { x: 0.5, y: 0.5, width: 0.05, height: 0.05 };
    const kept = dragCrop(small, 'nw', { x: 0.5, y: 0.5 }, TINY);
    expect(kept.x).toBeCloseTo(0.5);
    expect(kept.width).toBeCloseTo(0.05);
    expect(kept.height).toBeCloseTo(0.05);
  });

  it('always gives a crop the schema accepts', () => {
    const handles: readonly CropHandle[] = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w', 'inside'];
    for (const handle of handles) {
      for (const delta of [-2, -0.3, 0, 0.3, 2]) {
        const crop = dragCrop(HALF, handle, { x: delta, y: -delta }, TINY);
        expect(cropSchema.safeParse(crop).success).toBe(true);
      }
    }
  });
});

describe('isSameCrop', () => {
  it('compares every field', () => {
    expect(isSameCrop(HALF, { ...HALF })).toBe(true);
    for (const field of ['x', 'y', 'width', 'height'] as const) {
      expect(isSameCrop(HALF, { ...HALF, [field]: 0.3 })).toBe(false);
    }
  });
});

import { describe, expect, it } from 'vitest';

import type { AssetId, ImagePaint } from '@canvas/schema';

import { placeholderBinding, WHOLE_IMAGE, type ImageBinding } from './image-binding.js';
import {
  IMAGE_FILL_LEVEL_OF_DETAIL,
  IMAGE_FILL_TAIL_FLOATS,
  pageOfImageFill,
  writeImageFillTail,
} from './image-fill-record.js';

// The image-fill tail maps the box's unit point to the page through the paint's fit.

const paint = (fields: Partial<ImagePaint> = {}): ImagePaint => ({
  type: 'image',
  assetId: 'photo' as AssetId,
  naturalSize: { width: 4000, height: 3000 },
  fit: 'fill',
  crop: { x: 0, y: 0, width: 1, height: 1 },
  ...fields,
});

/** A level on page 3, in the right half of the top half of the page. */
const BOUND: ImageBinding = {
  color: [0.2, 0.4, 0.6, 1],
  parts: [
    {
      rect: WHOLE_IMAGE,
      source: { region: { page: 3, u0: 0.5, v0: 0, u1: 1, v1: 0.5 }, covers: WHOLE_IMAGE },
    },
  ],
};

function tailOf(
  box: { width: number; height: number },
  image: ImagePaint,
  binding: ImageBinding = BOUND,
  isAverage = false,
): number[] {
  const record = new Float32Array(2 + IMAGE_FILL_TAIL_FLOATS);
  writeImageFillTail(record, 2, box, image, binding, isAverage);
  return [...record.slice(2)];
}

describe('writeImageFillTail', () => {
  it('maps a fill’s crop into its level’s page region, clamped there, at texture weight 1', () => {
    const tail = tailOf(
      { width: 400, height: 300 },
      paint({ crop: { x: 0.25, y: 0, width: 0.5, height: 1 } }),
    );
    expect(tail).toEqual([
      // uvRect: the crop's corners on the page.
      0.625, 0, 0.875, 0.5,
      // clampRect: the level's region.
      0.5, 0, 1, 0.5,
      // imageFit: the drawn rectangle is the box.
      1, 1, 0, 0,
      // Texture weight, clamp mode.
      1, 0,
    ]);
  });

  it('letterboxes a fit inside the box, centred', () => {
    const tail = tailOf({ width: 400, height: 100 }, paint({ fit: 'fit' }));
    // Drawn 133.3 × 100 at x 133.3: the box is 3 drawn widths, starting one drawn width left.
    expect(tail[8]).toBeCloseTo(3);
    expect(tail[9]).toBeCloseTo(1);
    expect(tail[10]).toBeCloseTo(-1);
    expect(tail[11]).toBeCloseTo(0);
    expect(tail.slice(12)).toEqual([1, 1]);
  });

  it('repeats a tile at one image pixel per world unit from the top-left corner', () => {
    const tail = tailOf({ width: 400, height: 300 }, paint({ fit: 'tile' }));
    expect(tail.slice(8, 12).map((value) => Math.round(value * 1000) / 1000)).toEqual([
      0.1, 0.1, 0, 0,
    ]);
    expect(tail[13]).toBe(2);
  });

  it('draws the placeholder colour without a level, and in the average-colour form', () => {
    const placeholder = tailOf(
      { width: 400, height: 300 },
      paint(),
      placeholderBinding([1, 0, 0, 1]),
    );
    expect(placeholder.slice(0, 8)).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
    expect(placeholder[12]).toBe(0);
    expect(tailOf({ width: 400, height: 300 }, paint(), BOUND, true)[12]).toBe(0);
  });

  it('draws nothing of an empty box rather than dividing by zero', () => {
    const tail = tailOf({ width: 0, height: 0 }, paint());
    expect(tail.slice(8, 12)).toEqual([0, 0, 0, 0]);
    expect(tail.every(Number.isFinite)).toBe(true);
  });
});

describe('pageOfImageFill', () => {
  it('is the level’s page, or the placeholder page', () => {
    expect(pageOfImageFill(BOUND)).toBe(3);
    expect(pageOfImageFill(placeholderBinding([0, 0, 0, 1]))).toBe(
      pageOfImageFill(placeholderBinding([1, 1, 1, 1])),
    );
  });
});

describe('IMAGE_FILL_LEVEL_OF_DETAIL', () => {
  it('measures the box’s longer side, and a move as the same size', () => {
    const shape = { type: 'shape', width: 30, height: 80 } as never;
    const moved = { type: 'shape', width: 30, height: 80, x: 5 } as never;
    const grown = { type: 'shape', width: 31, height: 80 } as never;
    expect(IMAGE_FILL_LEVEL_OF_DETAIL.sizeOf(shape)).toBe(80);
    expect(IMAGE_FILL_LEVEL_OF_DETAIL.isSameSize?.(shape, moved)).toBe(true);
    expect(IMAGE_FILL_LEVEL_OF_DETAIL.isSameSize?.(shape, grown)).toBe(false);
  });
});

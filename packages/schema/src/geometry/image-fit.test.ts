import { describe, expect, it } from 'vitest';

import {
  croppedImageAspect,
  fittedImageRect,
  IMAGE_FIT_TOLERANCE,
  type FittedImage,
} from './image-fit.js';

const WHOLE = { x: 0, y: 0, width: 1, height: 1 };
const PHOTO = { width: 4000, height: 3000 };

/**
 * An image of the 4000 × 3000 photo in a box.
 *
 * @param width - Box width.
 * @param height - Box height.
 * @param crop - The crop.
 * @returns The image.
 */
function image(width: number, height: number, crop = WHOLE): FittedImage {
  return { width, height, crop, naturalSize: PHOTO };
}

/**
 * The drawn rectangle's aspect.
 *
 * @param rect - The rectangle.
 * @param rect.width - Its width.
 * @param rect.height - Its height.
 * @returns Width over height.
 */
function aspect(rect: { width: number; height: number }): number {
  return rect.width / rect.height;
}

describe('fittedImageRect', () => {
  it('fills a box whose aspect is the crop region’s', () => {
    expect(fittedImageRect(image(400, 300))).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    const half = { x: 0, y: 0, width: 0.5, height: 1 };
    expect(fittedImageRect(image(200, 300, half))).toEqual({ x: 0, y: 0, width: 200, height: 300 });
  });

  it('fills a box off the aspect by less than the tolerance', () => {
    const height = 300 * (1 + IMAGE_FIT_TOLERANCE / 2);
    expect(fittedImageRect(image(400, height))).toEqual({ x: 0, y: 0, width: 400, height });
  });

  it('fits a narrow crop in a wide box, centred across, at the crop’s aspect', () => {
    // The merge the reviewer found: the left half of a 4:3 photo (2:3) left in a 400 × 300 box.
    const drawn = fittedImageRect(image(400, 300, { x: 0, y: 0, width: 0.5, height: 1 }));
    expect(drawn).toEqual({ x: 100, y: 0, width: 200, height: 300 });
    expect(aspect(drawn)).toBeCloseTo((0.5 * 4000) / 3000, 12);
  });

  it('fits a whole image in a narrow box, centred down, never stretched', () => {
    const drawn = fittedImageRect(image(200, 300));
    expect(drawn).toEqual({ x: 0, y: 75, width: 200, height: 150 });
    expect(aspect(drawn)).toBeCloseTo(4 / 3, 12);
  });

  it('keeps the crop region’s aspect for any box and crop', () => {
    const crops = [
      WHOLE,
      { x: 0.25, y: 0.1, width: 0.3, height: 0.8 },
      { x: 0, y: 0.5, width: 1, height: 0.5 },
    ];
    for (const crop of crops) {
      for (const [width, height] of [
        [10, 1000],
        [1000, 10],
        [333, 777],
        [640, 480],
      ] as const) {
        const drawn = fittedImageRect(image(width, height, crop));
        const expected = (crop.width * PHOTO.width) / (crop.height * PHOTO.height);
        expect(Math.abs(aspect(drawn) / expected - 1)).toBeLessThanOrEqual(IMAGE_FIT_TOLERANCE);
        expect(drawn.width).toBeLessThanOrEqual(width + 1e-9);
        expect(drawn.height).toBeLessThanOrEqual(height + 1e-9);
        expect(drawn.x * 2 + drawn.width).toBeCloseTo(width, 9);
        expect(drawn.y * 2 + drawn.height).toBeCloseTo(height, 9);
      }
    }
  });

  it('leaves an empty box as it is', () => {
    expect(fittedImageRect(image(0, 300))).toEqual({ x: 0, y: 0, width: 0, height: 300 });
  });
});

describe('croppedImageAspect', () => {
  it('is the crop region’s aspect in the photo’s pixels', () => {
    expect(croppedImageAspect(image(1, 1))).toBeCloseTo(4 / 3);
    // The left half of a 4:3 photo is 2:3.
    expect(croppedImageAspect(image(1, 1, { x: 0, y: 0, width: 0.5, height: 1 }))).toBeCloseTo(
      2 / 3,
    );
    expect(Number.isFinite(croppedImageAspect(image(1, 1, { ...WHOLE, height: 0 })))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { cropPixels } from './engine-pixels.js';

/**
 * The red channel of each pixel.
 *
 * @param rgba - RGBA8 pixels.
 * @returns One value per pixel.
 */
function redChannel(rgba: Uint8Array): number[] {
  return [...rgba].filter((value, index) => index % 4 === 0);
}

// A 3 × 2 image whose red channel is the pixel's index.
function image(): Uint8Array<ArrayBuffer> {
  const pixels = new Uint8Array(3 * 2 * 4);
  for (let index = 0; index < 6; index += 1) pixels.set([index, 0, 0, 255], index * 4);
  return pixels;
}

describe('cropPixels', () => {
  it('copies the rectangle, rows top to bottom', () => {
    const block = cropPixels(
      image(),
      { widthPx: 3, heightPx: 2 },
      {
        xPx: 1,
        yPx: 0,
        widthPx: 2,
        heightPx: 2,
      },
    );
    expect(block.widthPx).toBe(2);
    expect(block.heightPx).toBe(2);
    expect(redChannel(block.rgba)).toEqual([1, 2, 4, 5]);
  });

  it('returns a copy, never a view of the source', () => {
    const source = image();
    const whole = cropPixels(
      source,
      { widthPx: 3, heightPx: 2 },
      {
        xPx: 0,
        yPx: 0,
        widthPx: 3,
        heightPx: 2,
      },
    );
    expect(whole.rgba).toEqual(source);
    expect(whole.rgba.buffer).not.toBe(source.buffer);
  });

  it('rejects a rectangle outside the image or not in whole pixels', () => {
    const size = { widthPx: 3, heightPx: 2 };
    for (const rect of [
      { xPx: 2, yPx: 0, widthPx: 2, heightPx: 1 },
      { xPx: -1, yPx: 0, widthPx: 1, heightPx: 1 },
      { xPx: 0, yPx: 0, widthPx: 0, heightPx: 1 },
      { xPx: 0.5, yPx: 0, widthPx: 1, heightPx: 1 },
    ]) {
      expect(() => cropPixels(image(), size, rect)).toThrow(RangeError);
    }
  });

  it('rejects pixels that do not match the stated size', () => {
    expect(() =>
      cropPixels(
        new Uint8Array(4),
        { widthPx: 3, heightPx: 2 },
        {
          xPx: 0,
          yPx: 0,
          widthPx: 1,
          heightPx: 1,
        },
      ),
    ).toThrow(RangeError);
  });
});

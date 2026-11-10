import { describe, expect, it } from 'vitest';

import { cropUnpremultiplied } from './pixel-capture.js';

/**
 * A 3 × 2 buffer whose pixel (x, y) is premultiplied (10x, 10y, 0, 255), except (2, 1).
 *
 * @returns The buffer, RGBA8, top row first.
 */
function buffer(): Uint8Array<ArrayBuffer> {
  const pixels = new Uint8Array(3 * 2 * 4);
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 3; x += 1) pixels.set([10 * x, 10 * y, 0, 255], (y * 3 + x) * 4);
  }
  // Half-covered red, premultiplied: (64, 0, 0, 128) is straight (128, 0, 0, 128).
  pixels.set([64, 0, 0, 128], (1 * 3 + 2) * 4);
  return pixels;
}

describe('cropUnpremultiplied', () => {
  it('copies a rectangle out of a top-down RGBA8 buffer', () => {
    const block = cropUnpremultiplied(buffer(), 3, { xPx: 1, yPx: 0, widthPx: 2, heightPx: 1 });
    expect([...block]).toEqual([10, 0, 0, 255, 20, 0, 0, 255]);
  });

  it('undoes premultiplied alpha, and leaves transparent black alone', () => {
    const pixels = buffer();
    pixels.set([0, 0, 0, 0], 0);
    expect([
      ...cropUnpremultiplied(pixels, 3, { xPx: 2, yPx: 1, widthPx: 1, heightPx: 1 }),
    ]).toEqual([128, 0, 0, 128]);
    expect([
      ...cropUnpremultiplied(pixels, 3, { xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 }),
    ]).toEqual([0, 0, 0, 0]);
  });
});

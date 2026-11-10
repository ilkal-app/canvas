import { describe, expect, it } from 'vitest';

import { alignedBytesPerRow, flipRows, unpackTextureReadback } from './pixel-readback.js';

/**
 * A 2×2 RGBA8 image whose every texel holds four copies of one value.
 *
 * @param rowZero - The values of row 0's texels.
 * @param rowOne - The values of row 1's texels.
 * @returns The image bytes, row 0 first.
 */
function twoByTwo(rowZero: [number, number], rowOne: [number, number]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([rowZero, rowOne].flat().flatMap((texel) => [texel, texel, texel, texel]));
}

describe('flipRows', () => {
  it('turns WebGL2 bottom-up rows into top-down rows', () => {
    const bottomUp = twoByTwo([3, 4], [1, 2]);
    expect(flipRows(bottomUp, 2, 2)).toEqual(twoByTwo([1, 2], [3, 4]));
  });

  it('does not mutate its input', () => {
    const bottomUp = twoByTwo([3, 4], [1, 2]);
    flipRows(bottomUp, 2, 2);
    expect(bottomUp).toEqual(twoByTwo([3, 4], [1, 2]));
  });
});

describe('alignedBytesPerRow', () => {
  it('rounds an RGBA8 row up to the 256 bytes a WebGPU texture copy needs', () => {
    expect([alignedBytesPerRow(1), alignedBytesPerRow(64), alignedBytesPerRow(65)]).toEqual([
      256, 256, 512,
    ]);
  });
});

describe('unpackTextureReadback', () => {
  it('drops the row padding of a WebGPU copy', () => {
    const padded = new Uint8Array(2 * 256);
    padded.set([1, 2, 3, 4], 0);
    padded.set([5, 6, 7, 8], 256);
    expect(Array.from(unpackTextureReadback(padded, 1, 2, 256, 'rgba8unorm'))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('swizzles a bgra8unorm canvas into RGBA', () => {
    const padded = new Uint8Array(256);
    padded.set([30, 20, 10, 255], 0);
    expect(Array.from(unpackTextureReadback(padded, 1, 1, 256, 'bgra8unorm'))).toEqual([
      10, 20, 30, 255,
    ]);
  });
});

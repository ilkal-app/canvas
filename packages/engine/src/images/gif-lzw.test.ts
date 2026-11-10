import { describe, expect, it } from 'vitest';

import { decodeGifLzw } from './gif-lzw.js';

/**
 * Packs codes as a GIF encoder would, growing the code size when the decoder's table reaches the
 * next power of two, up to 12 bits, and starting over at each clear code.
 *
 * @param codes - The codes, a clear code first.
 * @param minCodeSize - The minimum code size, bits.
 * @returns The packed bytes.
 */
function pack(codes: readonly number[], minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const out: number[] = [];
  let size = minCodeSize + 1;
  let next = clear + 2;
  let isFirst = true;
  let bits = 0;
  let count = 0;
  for (const code of codes) {
    bits |= code << count;
    count += size;
    while (count >= 8) {
      out.push(bits & 0xff);
      bits >>>= 8;
      count -= 8;
    }
    if (code === clear) {
      size = minCodeSize + 1;
      next = clear + 2;
      isFirst = true;
    } else if (isFirst) {
      isFirst = false;
    } else if (next < 4096) {
      next += 1;
      if (next === 1 << size && size < 12) size += 1;
    }
  }
  if (count > 0) out.push(bits & 0xff);
  return new Uint8Array(out);
}

describe('decodeGifLzw', () => {
  it('decodes a code defined by the code itself (KwKwK)', () => {
    // After clear and 1, code 6 is not defined yet: it is "1" plus its own first byte.
    expect([...decodeGifLzw(2, pack([4, 1, 6, 5], 2), 3)]).toEqual([1, 1, 1]);
  });

  it('keeps decoding with a full table until a clear code (a deferred clear)', () => {
    const literals = Array.from({ length: 5000 }, (unused, index) => index % 2);
    const decoded = decodeGifLzw(2, pack([4, ...literals, 4, 3, 5], 2), 5001);
    expect([...decoded.subarray(0, 4)]).toEqual([0, 1, 0, 1]);
    expect(decoded[4999]).toBe(1);
    expect(decoded[5000]).toBe(3);
  });

  it('stops at the end code, leaving the rest of the pixels at index 0', () => {
    expect([...decodeGifLzw(2, pack([4, 1, 5, 2], 2), 3)]).toEqual([1, 0, 0]);
  });

  it('cuts a string that runs past the last pixel', () => {
    expect([...decodeGifLzw(2, pack([4, 1, 1, 6, 5], 2), 3)]).toEqual([1, 1, 1]);
  });

  it('refuses a frame that starts with, or uses, a code it has not defined', () => {
    expect(() => decodeGifLzw(2, pack([4, 7, 5], 2), 4)).toThrow(/starts with/);
    expect(() => decodeGifLzw(2, pack([4, 1, 7, 5], 2), 4)).toThrow(/not defined/);
  });
});

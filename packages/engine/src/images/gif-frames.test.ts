import { describe, expect, it } from 'vitest';

import { encodeFixtureGif, type FixtureGifSpec } from './fixture-gif.js';
import { isGif, MAX_GIF_FRAMES, parseGif } from './gif-file.js';
import {
  MAX_GIF_COMPOSE_PIXELS,
  animationDecodeSize,
  decodeGifFrames,
  downscalePremultiplied,
  gifFrameDurationMs,
  gifPlays,
} from './gif-frames.js';
import { decodeGifLzw } from './gif-lzw.js';

const RED = [255, 0, 0] as const;
const GREEN = [0, 255, 0] as const;
const BLUE = [0, 0, 255] as const;
const WHITE = [255, 255, 255] as const;

const LIMITS = { maxLongEdgePx: 512, maxBytes: 64 * 1024 * 1024 };

function bytesOf(spec: FixtureGifSpec): Uint8Array {
  return new Uint8Array(encodeFixtureGif(spec));
}

function pixel(rgba: Uint8Array, width: number, x: number, y: number): number[] {
  const at = (y * width + x) * 4;
  return [...rgba.subarray(at, at + 4)];
}

describe('parseGif', () => {
  it('reads the canvas, each frame and the loop count', () => {
    const file = parseGif(
      bytesOf({
        widthPx: 4,
        heightPx: 3,
        palette: [RED, GREEN],
        loopCount: 0,
        frames: [
          { indices: 0, delayCs: 5 },
          { indices: 1, delayCs: 20, disposal: 2, transparentIndex: 0 },
        ],
      }),
    );
    expect(file).toMatchObject({ widthPx: 4, heightPx: 3, loopCount: 0 });
    expect(file.frames).toHaveLength(2);
    expect(file.frames[1]).toMatchObject({
      left: 0,
      top: 0,
      width: 4,
      height: 3,
      delayMs: 200,
      disposal: 2,
      transparentIndex: 0,
    });
  });

  it('grows the canvas to the first frame and its offset, as the app sizes a GIF', () => {
    const file = parseGif(
      bytesOf({
        widthPx: 2,
        heightPx: 2,
        palette: [RED, GREEN],
        frames: [{ indices: 0, rect: { left: 1, top: 2, width: 3, height: 3 } }],
      }),
    );
    expect(file).toMatchObject({ widthPx: 4, heightPx: 5, loopCount: undefined });
  });

  it('refuses what is not a GIF, a GIF without an image, and one with too many frames', () => {
    expect(isGif(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe(false);
    expect(() => parseGif(new Uint8Array(10))).toThrow(RangeError);
    const noImage = bytesOf({ widthPx: 1, heightPx: 1, palette: [RED], frames: [] });
    expect(() => parseGif(noImage)).toThrow(/no image/);
    const many = bytesOf({
      widthPx: 1,
      heightPx: 1,
      palette: [RED, GREEN],
      frames: Array.from({ length: MAX_GIF_FRAMES + 1 }, () => ({ indices: 0 })),
    });
    expect(() => parseGif(many)).toThrow(/more than/);
  });

  it('keeps the frames of a file cut after its first image', () => {
    const bytes = bytesOf({
      widthPx: 2,
      heightPx: 2,
      palette: [RED, GREEN],
      frames: [{ indices: 0 }, { indices: 1 }],
    });
    const cut = bytes.subarray(0, bytes.length - 8);
    expect(parseGif(cut).frames.length).toBeGreaterThanOrEqual(1);
  });
});

describe('decodeGifLzw', () => {
  it('decodes codes that grow past their first size', () => {
    // A hand-packed stream at min code size 2: clear, 1, 1 (adds code 6 = "1 1"), 6, end.
    // 3-bit codes: 4, 1, 1, 6, 5 → bits little-endian.
    const codes = [4, 1, 1, 6, 5];
    let bits = 0;
    codes.forEach((code, index) => {
      bits |= code << (index * 3);
    });
    const data = new Uint8Array([bits & 0xff, (bits >> 8) & 0xff]);
    expect([...decodeGifLzw(2, data, 4)]).toEqual([1, 1, 1, 1]);
  });

  it('leaves the rest at index 0 when the data ends early, and refuses a bad code size', () => {
    expect([...decodeGifLzw(2, new Uint8Array([0x0c]), 3)]).toEqual([1, 0, 0]);
    expect(() => decodeGifLzw(1, new Uint8Array(1), 1)).toThrow(RangeError);
  });
});

describe('decodeGifFrames', () => {
  it('composes frames with transparency and each disposal method', () => {
    const decoded = decodeGifFrames(
      bytesOf({
        widthPx: 2,
        heightPx: 1,
        palette: [RED, GREEN, BLUE, WHITE],
        loopCount: 2,
        frames: [
          { indices: 0 },
          // Green on the right only; its left pixel is transparent, so red stays there.
          { indices: new Uint8Array([3, 1]), transparentIndex: 3, disposal: 3 },
          // After disposal 3 the canvas is red again; blue on the left, then cleared.
          { indices: 2, rect: { left: 0, top: 0, width: 1, height: 1 }, disposal: 2 },
          { indices: 3, rect: { left: 1, top: 0, width: 1, height: 1 }, transparentIndex: 3 },
        ],
      }),
      LIMITS,
    );
    expect(decoded).toMatchObject({ widthPx: 2, heightPx: 1, plays: 3 });
    const shown = decoded.frames.map(({ rgba }) => [pixel(rgba, 2, 0, 0), pixel(rgba, 2, 1, 0)]);
    expect(shown).toEqual([
      [
        [255, 0, 0, 255],
        [255, 0, 0, 255],
      ],
      [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
      ],
      [
        [0, 0, 255, 255],
        [255, 0, 0, 255],
      ],
      [
        [0, 0, 0, 0],
        [255, 0, 0, 255],
      ],
    ]);
  });

  it('reads interlaced rows into their places', () => {
    const rows = Array.from({ length: 9 }, (unused, row) => row % 4);
    const decoded = decodeGifFrames(
      bytesOf({
        widthPx: 1,
        heightPx: 9,
        palette: [RED, GREEN, BLUE, WHITE],
        frames: [{ indices: new Uint8Array(rows), isInterlaced: true }],
      }),
      LIMITS,
    );
    const colours = [RED, GREEN, BLUE, WHITE];
    rows.forEach((index, row) => {
      expect(pixel(decoded.frames[0]?.rgba ?? new Uint8Array(), 1, 0, row)).toEqual([
        ...(colours[index] ?? RED),
        255,
      ]);
    });
  });

  it('times frames as browsers do and counts plays from the loop extension', () => {
    expect(gifFrameDurationMs(0)).toBe(100);
    expect(gifFrameDurationMs(10)).toBe(100);
    expect(gifFrameDurationMs(20)).toBe(20);
    expect(gifFrameDurationMs(70)).toBe(70);
    expect(gifPlays(undefined)).toBe(1);
    expect(gifPlays(0)).toBe(Infinity);
    expect(gifPlays(2)).toBe(3);
    const decoded = decodeGifFrames(
      bytesOf({
        widthPx: 1,
        heightPx: 1,
        palette: [RED, GREEN],
        frames: [
          { indices: 0, delayCs: 0 },
          { indices: 1, delayCs: 7 },
        ],
      }),
      LIMITS,
    );
    expect(decoded.frames.map(({ durationMs }) => durationMs)).toEqual([100, 70]);
    expect(decoded.plays).toBe(1);
  });

  it('scales frames down to the edge and byte limits, averaging premultiplied', () => {
    expect(animationDecodeSize({ width: 400, height: 200 }, 10, LIMITS)).toEqual({
      width: 400,
      height: 200,
    });
    expect(animationDecodeSize({ width: 1024, height: 512 }, 1, LIMITS)).toEqual({
      width: 512,
      height: 256,
    });
    const byBytes = animationDecodeSize({ width: 400, height: 400 }, 100, {
      maxLongEdgePx: 512,
      maxBytes: 100 * 100 * 100 * 4,
    });
    expect(byBytes).toEqual({ width: 100, height: 100 });
    // Half opaque red, half transparent green: the average keeps no green.
    const source = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0]);
    expect([
      ...downscalePremultiplied(source, { width: 2, height: 1 }, { width: 1, height: 1 }),
    ]).toEqual([128, 0, 0, 128]);
    const decoded = decodeGifFrames(
      bytesOf({
        widthPx: 8,
        heightPx: 4,
        palette: [RED, GREEN],
        frames: [{ indices: 0 }, { indices: 1 }],
      }),
      { maxLongEdgePx: 4, maxBytes: 1024 },
    );
    expect(decoded).toMatchObject({ widthPx: 4, heightPx: 2 });
    expect(pixel(decoded.frames[1]?.rgba ?? new Uint8Array(), 4, 3, 1)).toEqual([0, 255, 0, 255]);
  });

  it('does not change the bytes it decodes', () => {
    const bytes = bytesOf({
      widthPx: 2,
      heightPx: 2,
      palette: [RED, GREEN],
      frames: [{ indices: 1 }],
    });
    const copy = bytes.slice();
    decodeGifFrames(bytes, LIMITS);
    expect(bytes).toEqual(copy);
  });

  it('clips a later frame to the canvas and skips indices past the colour table', () => {
    const decoded = decodeGifFrames(
      bytesOf({
        widthPx: 2,
        heightPx: 1,
        palette: [RED, GREEN],
        frames: [
          { indices: 0 },
          // Larger than the canvas and offset: only its pixel at (1, 0) lands, in green.
          { indices: 1, rect: { left: 1, top: 0, width: 3, height: 2 } },
          // Index 3 is past the two-colour table: drawn as nothing. Then cleared off the canvas.
          { indices: 3, rect: { left: 5, top: 0, width: 1, height: 1 }, disposal: 2 },
        ],
      }),
      LIMITS,
    );
    const shown = decoded.frames.map(({ rgba }) => [pixel(rgba, 2, 0, 0), pixel(rgba, 2, 1, 0)]);
    expect(shown[1]).toEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ]);
    expect(shown[2]).toEqual(shown[1]);
  });

  it('refuses a GIF with more canvas pixels to compose than playback takes', () => {
    // A 16384 × 16384 logical screen with two 1 px frames: nothing large is stored, but each
    // frame would be composed on the whole canvas.
    const bytes = bytesOf({
      widthPx: 16_384,
      heightPx: 16_384,
      palette: [RED, GREEN],
      frames: [
        { indices: 0, rect: { left: 0, top: 0, width: 1, height: 1 } },
        { indices: 1, rect: { left: 0, top: 0, width: 1, height: 1 } },
      ],
    });
    expect(2 * 16_384 * 16_384).toBeGreaterThan(MAX_GIF_COMPOSE_PIXELS);
    expect(() => decodeGifFrames(bytes, LIMITS)).toThrow(/too many pixels/);
  });

  it('encodes an empty frame, and refuses an empty or oversized palette', () => {
    const file = parseGif(
      bytesOf({
        widthPx: 1,
        heightPx: 1,
        palette: [RED],
        frames: [{ indices: 0, rect: { left: 0, top: 0, width: 0, height: 0 } }],
      }),
    );
    expect(file.frames[0]).toMatchObject({ width: 0, height: 0 });
    expect(() => encodeFixtureGif({ widthPx: 1, heightPx: 1, palette: [], frames: [] })).toThrow(
      RangeError,
    );
    const many = Array.from({ length: 257 }, () => RED);
    expect(() => encodeFixtureGif({ widthPx: 1, heightPx: 1, palette: many, frames: [] })).toThrow(
      RangeError,
    );
  });
});

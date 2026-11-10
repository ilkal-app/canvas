import { describe, expect, it } from 'vitest';

import { parseGif } from './gif-file.js';
import { decodeGifFrames } from './gif-frames.js';

// GIF structures the fixture encoder never writes, built byte by byte: local colour tables,
// comments and other extensions, short or odd blocks, and files cut or broken in the middle.

/**
 * `GIF89a`, a 2 × 1 logical screen, with or without a two-colour global table.
 *
 * @param hasGlobalTable - Whether it has a global colour table.
 * @returns The header's bytes.
 */
function header(hasGlobalTable: boolean): number[] {
  const signature = text('GIF89a');
  const table = hasGlobalTable ? [255, 0, 0, 0, 0, 255] : [];
  return [...signature, 2, 0, 1, 0, hasGlobalTable ? 0x80 : 0, 0, 0, ...table];
}

/**
 * A 2 × 1 image of colour index 1 everywhere, LZW at code size 2 (clear, 1, 1, end).
 *
 * @param localTable - A two-colour local table, if any.
 * @returns The image descriptor and its data.
 */
function image(localTable?: readonly number[]): number[] {
  const packed = localTable === undefined ? 0 : 0x80;
  // 3-bit codes 4, 1, 1, 5, little-endian: 100 001 001 101.
  const codes = 4 | (1 << 3) | (1 << 6) | (5 << 9);
  return [
    0x2c,
    0,
    0,
    0,
    0,
    2,
    0,
    1,
    0,
    packed,
    ...(localTable ?? []),
    2,
    2,
    codes & 0xff,
    codes >> 8,
    0,
  ];
}

function text(value: string): number[] {
  return Array.from({ length: value.length }, (unused, index) => value.charCodeAt(index));
}

function gif(...parts: number[][]): Uint8Array {
  return new Uint8Array(parts.flat());
}

const TRAILER = [0x3b];
const LIMITS = { maxLongEdgePx: 64, maxBytes: 1024 };

describe('parseGif structures', () => {
  it('draws an image from its own colour table when it has one', () => {
    const file = gif(header(false), image([0, 0, 0, 0, 200, 0]), TRAILER);
    const decoded = decodeGifFrames(file, LIMITS);
    expect([...(decoded.frames[0]?.rgba.subarray(0, 4) ?? [])]).toEqual([0, 200, 0, 255]);
  });

  it('refuses an image with no colour table at all', () => {
    expect(() => parseGif(gif(header(false), image(), TRAILER))).toThrow(/no colour table/);
  });

  it('skips comments and unknown extensions, and reads a GIF without a trailer', () => {
    const comment = [0x21, 0xfe, 3, ...text('hey'), 0];
    const file = parseGif(gif(header(true), comment, image()));
    expect(file.frames).toHaveLength(1);
  });

  it('reads ANIMEXTS1.0 loops, and ignores other or malformed application data', () => {
    const app = (name: string, data: number[] | undefined): number[] => [
      0x21,
      0xff,
      name.length,
      ...text(name),
      ...(data === undefined ? [] : [data.length, ...data]),
      0,
    ];
    const loopOf = (...blocks: number[][]): number | undefined =>
      parseGif(gif(header(true), ...blocks, image(), TRAILER)).loopCount;
    expect(loopOf(app('ANIMEXTS1.0', [1, 3, 0]))).toBe(3);
    expect(loopOf(app('XMP DataXMP', [1, 3, 0]))).toBeUndefined();
    expect(loopOf(app('NETSCAPE2.0', [1, 3]))).toBeUndefined();
    expect(loopOf(app('NETSCAPE2.0', [2, 3, 0]))).toBeUndefined();
    expect(loopOf(app('NETSCAPE2.0', undefined))).toBeUndefined();
    expect(loopOf([0x21, 0xff, 0])).toBeUndefined();
    // A later malformed block keeps the loop count read before it.
    expect(loopOf(app('NETSCAPE2.0', [1, 0, 0]), app('XMP DataXMP', [0]))).toBe(0);
  });

  it('ignores a graphic control block too short to read', () => {
    const shortControl = [0x21, 0xf9, 2, 0, 5, 0];
    const [frame] = parseGif(gif(header(true), shortControl, image(), TRAILER)).frames;
    expect(frame).toMatchObject({ delayMs: 0, disposal: 0, transparentIndex: undefined });
  });

  it('keeps the frames read before an unknown block, and refuses one before any frame', () => {
    expect(parseGif(gif(header(true), image(), [0x99], image(), TRAILER)).frames).toHaveLength(1);
    expect(() => parseGif(gif(header(true), [0x99], image(), TRAILER))).toThrow(/unknown block/);
  });

  it('refuses a file cut inside a block before its first image', () => {
    expect(() => parseGif(gif(header(true), [0x21, 0xfe, 9, 1, 2]))).toThrow(RangeError);
    expect(() => parseGif(gif(header(true), [0x21]))).toThrow(RangeError);
  });
});

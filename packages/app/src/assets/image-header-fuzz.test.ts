import { describe, expect, it } from 'vitest';

import {
  avifBytes,
  gifBytes,
  jpegBytes,
  pngBytes,
  webpBytes,
} from './__fixtures__/image-headers.js';
import { readImageHeaderSize, type ByteReader } from './image-header.js';

/** How many mutated files each kind of header is read as. */
const CASES_PER_KIND = 300;

/**
 * A seeded generator of numbers in [0, 1) (mulberry32), so a failure replays.
 *
 * @param seed - The seed.
 * @returns The generator.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A copy of a file with a few bytes changed at random and, at random, cut short.
 *
 * @param bytes - The file.
 * @param random - The generator.
 * @returns The mutated file.
 */
function mutated(bytes: Uint8Array, random: () => number): Uint8Array {
  const copy = bytes.slice();
  const changes = 1 + Math.floor(random() * 4);
  for (let change = 0; change < changes; change += 1) {
    copy[Math.floor(random() * copy.length)] = Math.floor(random() * 256);
  }
  return random() < 0.3 ? copy.slice(0, Math.floor(random() * copy.length)) : copy;
}

/**
 * A reader over bytes that counts its reads and the bytes they returned.
 *
 * @param bytes - The file.
 * @returns The reader and its counts.
 */
function counting(bytes: Uint8Array) {
  const counts = { reads: 0, bytes: 0 };
  const read: ByteReader = (offset, length) => {
    counts.reads += 1;
    const slice = bytes.slice(offset, offset + length);
    counts.bytes += slice.length;
    return Promise.resolve(slice);
  };
  return { read, counts };
}

const KINDS: readonly (readonly [string, Uint8Array])[] = [
  ['PNG', pngBytes(640, 480)],
  [
    'GIF',
    gifBytes(10, 10, {
      frame: { width: 4000, height: 3000 },
      colourTableBits: 2,
      extensions: [{ label: 0xfe, data: 700 }],
    }),
  ],
  ['lossy WebP', webpBytes('VP8 ', 1000, 750)],
  ['lossless WebP', webpBytes('VP8L', 1000, 750)],
  ['extended WebP', webpBytes('VP8X', 1000, 750)],
  ['JPEG', jpegBytes(4000, 3000, { orientation: 6, padding: 2000, isLittleEndian: true })],
  [
    'AVIF',
    avifBytes([
      [512, 256],
      [6000, 4000],
    ]),
  ],
];

describe('readImageHeaderSize on mutated headers (seeded fuzz)', () => {
  it.each(KINDS)(
    'never throws on a mutated %s, answers a whole size or nothing, and reads a bounded amount',
    async (kind, bytes) => {
      const random = seeded(kind.length * 7919 + bytes.length);
      for (let index = 0; index < CASES_PER_KIND; index += 1) {
        const file = mutated(bytes, random);
        const { read, counts } = counting(file);
        const size = await readImageHeaderSize(read);
        if (size !== undefined) {
          expect(Number.isInteger(size.width) && size.width > 0).toBe(true);
          expect(Number.isInteger(size.height) && size.height > 0).toBe(true);
        }
        // Headers only: never much more than the file, and a bounded number of reads.
        expect(counts.bytes).toBeLessThanOrEqual(file.length * 2 + 64);
        expect(counts.reads).toBeLessThanOrEqual(4200);
      }
    },
  );
});

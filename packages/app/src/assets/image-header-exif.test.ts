import { describe, expect, it } from 'vitest';

import { jpegBytes, pngBytes, webpBytes } from './__fixtures__/image-headers.js';
import { readImageHeaderSize } from './image-header.js';

/**
 * Encodes a metadata chunk using the container's byte order and padding.
 *
 * @param kind - Chunk type.
 * @param body - Chunk payload.
 * @param isPng - PNG encoding instead of RIFF.
 * @returns The encoded chunk.
 */
function chunk(kind: string, body: Uint8Array, isPng: boolean): Uint8Array {
  const bytes = new Uint8Array(body.length + 8 + (isPng ? 4 : body.length % 2));
  const view = new DataView(bytes.buffer);
  view.setUint32(isPng ? 0 : 4, body.length, !isPng);
  bytes.set(new TextEncoder().encode(kind), isPng ? 4 : 0);
  bytes.set(body, 8);
  return bytes;
}

/**
 * Adds EXIF to the header fixture, including an odd-sized WebP chunk before it.
 *
 * @param isPng - PNG encoding instead of RIFF.
 * @param orientation - TIFF orientation.
 * @param isLittle - Little-endian TIFF encoding.
 * @returns The image header and metadata.
 */
function fixture(isPng: boolean, orientation: number, isLittle: boolean): Uint8Array {
  const jpeg = jpegBytes(320, 120, { orientation, isLittleEndian: isLittle });
  const exif = jpeg.slice(12, 38);
  const head = isPng ? pngBytes(320, 120) : webpBytes('VP8X', 320, 120);
  if (!isPng) head[20] = 0x08;
  const extra = isPng ? new Uint8Array() : chunk('JUNK', new Uint8Array([1]), false);
  const meta = chunk(isPng ? 'eXIf' : 'EXIF', exif, isPng);
  const bytes = new Uint8Array([...head, ...extra, ...meta]);
  if (!isPng) new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  return bytes;
}

describe.each([true, false])('chunked EXIF, PNG=%s', (isPng) => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'uses orientation %s for the upright size',
    async (orientation) => {
      for (const isLittle of [true, false]) {
        const bytes = fixture(isPng, orientation, isLittle);
        const result = await readImageHeaderSize((offset, length) =>
          Promise.resolve(bytes.slice(offset, offset + length)),
        );
        expect(result).toEqual(
          orientation >= 5 ? { width: 120, height: 320 } : { width: 320, height: 120 },
        );
      }
    },
  );
});

/**
 * Reads a crafted file without decoding any pixels.
 *
 * @param bytes - Crafted file bytes.
 * @returns Its upright dimensions.
 */
function sizeOf(bytes: Uint8Array) {
  return readImageHeaderSize((offset, length) =>
    Promise.resolve(bytes.slice(offset, offset + length)),
  );
}

describe('chunked EXIF boundaries', () => {
  it('accepts the optional WebP Exif identifier', async () => {
    const bytes = fixture(false, 6, true);
    const metaAt = 40;
    const prefixed = new Uint8Array([
      ...bytes.slice(0, metaAt),
      ...chunk(
        'EXIF',
        new Uint8Array([...new TextEncoder().encode('Exif\0\0'), ...bytes.slice(metaAt + 8)]),
        false,
      ),
    ]);
    new DataView(prefixed.buffer).setUint32(4, prefixed.length - 8, true);
    expect(await sizeOf(prefixed)).toEqual({ width: 120, height: 320 });
  });

  it('ignores PNG metadata after image data or the end marker', async () => {
    const bytes = fixture(true, 6, true);
    for (const type of ['IDAT', 'IEND']) {
      const late = new Uint8Array([
        ...bytes.slice(0, 33),
        ...chunk(type, new Uint8Array(), true),
        ...bytes.slice(33),
      ]);
      expect(await sizeOf(late)).toEqual({ width: 320, height: 120 });
    }
  });

  it.each([true, false])('ignores malformed or truncated TIFF in PNG=%s', async (isPng) => {
    const bytes = fixture(isPng, 6, true);
    const tiffAt = isPng ? 41 : 48;
    for (const [offset, value] of [
      [0, 0],
      [2, 0],
      [4, 255],
      [12, 4],
      [14, 2],
    ]) {
      const malformed = bytes.slice();
      if (offset === undefined || value === undefined)
        throw new Error('mutation has an offset and value');
      malformed[tiffAt + offset] = value;
      expect(await sizeOf(malformed)).toEqual({ width: 320, height: 120 });
    }
    expect(await sizeOf(bytes.slice(0, tiffAt + 19))).toEqual({ width: 320, height: 120 });
  });

  it('does not read WebP metadata beyond the declared RIFF boundary', async () => {
    const bytes = fixture(false, 6, true);
    new DataView(bytes.buffer).setUint32(4, 32, true);
    expect(await sizeOf(bytes)).toEqual({ width: 320, height: 120 });
  });

  it.each([true, false])('caps metadata allocation and chunk walking in PNG=%s', async (isPng) => {
    const head = isPng ? pngBytes(320, 120) : webpBytes('VP8X', 320, 120);
    if (!isPng) head[20] = 0x08;
    const large = chunk(isPng ? 'eXIf' : 'EXIF', new Uint8Array(), isPng);
    new DataView(large.buffer).setUint32(isPng ? 0 : 4, 2 ** 30, !isPng);
    const bytes = new Uint8Array([...head, ...large]);
    if (!isPng) new DataView(bytes.buffer).setUint32(4, 2 ** 31, true);
    let largestRead = 0;
    expect(
      await readImageHeaderSize((offset, length) => {
        largestRead = Math.max(largestRead, length);
        return Promise.resolve(bytes.slice(offset, offset + length));
      }),
    ).toEqual({ width: 320, height: 120 });
    expect(largestRead).toBe(30);
    const empty = chunk('JUNK', new Uint8Array(), isPng);
    let reads = 0;
    expect(
      await readImageHeaderSize((offset, length) => {
        reads += 1;
        return Promise.resolve(
          offset < head.length ? bytes.slice(offset, offset + length) : empty.slice(0, length),
        );
      }),
    ).toEqual({ width: 320, height: 120 });
    expect(reads).toBe(1025);
  });
});

describe('container and TIFF orientation rules', () => {
  it('ignores WebP EXIF when the VP8X flag is clear', async () => {
    const bytes = fixture(false, 6, true);
    bytes[20] = 0;
    expect(await sizeOf(bytes)).toEqual({ width: 320, height: 120 });
  });

  it.each(['VP8 ', 'VP8L'] as const)('ignores trailing EXIF in simple %s', async (kind) => {
    const head = webpBytes(kind, 320, 120);
    const bytes = new Uint8Array([
      ...head,
      ...new Uint8Array(head.length % 2),
      ...chunk('EXIF', jpegBytes(320, 120, { orientation: 6 }).slice(12, 38), false),
    ]);
    new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
    expect(await sizeOf(bytes)).toEqual({ width: 320, height: 120 });
  });

  it.each([true, false])(
    'ignores JPEG orientation encoded as TIFF LONG (little=%s)',
    async (isLittle) => {
      const bytes = jpegBytes(320, 120, { orientation: 6, isLittleEndian: isLittle });
      new DataView(bytes.buffer).setUint16(24, 4, isLittle);
      new DataView(bytes.buffer).setUint32(30, 6, isLittle);
      expect(await sizeOf(bytes)).toEqual({ width: 320, height: 120 });
    },
  );

  it('retains JPEG dimensions without an orientation tag', async () => {
    const bytes = jpegBytes(320, 120, { orientation: 6, isLittleEndian: true });
    new DataView(bytes.buffer).setUint16(22, 0x0113, true);
    expect(await sizeOf(bytes)).toEqual({ width: 320, height: 120 });
  });

  it.each([true, false])(
    'retains dimensions without an orientation tag (PNG=%s)',
    async (isPng) => {
      const bytes = fixture(isPng, 6, true);
      const tiffAt = isPng ? 41 : 48;
      new DataView(bytes.buffer).setUint16(tiffAt + 10, 0x0113, true);
      expect(await sizeOf(bytes)).toEqual({ width: 320, height: 120 });
    },
  );
});

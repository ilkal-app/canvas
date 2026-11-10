import { describe, expect, it } from 'vitest';

import {
  avifBytes,
  gifBytes,
  jpegBytes,
  pngBytes,
  webpBytes,
} from './__fixtures__/image-headers.js';
import { blobReader, readImageHeaderSize, type ByteReader } from './image-header.js';

/**
 * A reader over bytes that counts what it read.
 *
 * @param bytes - The file.
 * @returns The reader and the bytes read so far.
 */
function counting(bytes: Uint8Array): { read: ByteReader; readBytes: () => number } {
  let total = 0;
  return {
    read: (offset, length) => {
      const slice = bytes.slice(offset, offset + length);
      total += slice.length;
      return Promise.resolve(slice);
    },
    readBytes: () => total,
  };
}

/**
 * The size read from a file's header.
 *
 * @param bytes - The file.
 * @returns The size, or undefined.
 */
function sizeOf(bytes: Uint8Array) {
  return readImageHeaderSize(counting(bytes).read);
}

describe('readImageHeaderSize', () => {
  it('reads a PNG’s IHDR and a GIF’s logical screen', async () => {
    expect(await sizeOf(pngBytes(640, 480))).toEqual({ width: 640, height: 480 });
    expect(await sizeOf(gifBytes(300, 200))).toEqual({ width: 300, height: 200 });
  });

  it('takes a GIF’s first frame when it is larger than its logical screen', async () => {
    // A 10 × 10 screen hiding a 20,000 × 20,000 frame (400 megapixels) behind a colour table and
    // a comment and an application extension of several sub-blocks.
    const bomb = gifBytes(10, 10, {
      frame: { width: 20_000, height: 20_000 },
      colourTableBits: 7,
      extensions: [
        { label: 0xfe, data: 600 },
        { label: 0xff, data: 11 },
      ],
    });
    const { read, readBytes } = counting(bomb);
    expect(await readImageHeaderSize(read)).toEqual({ width: 20_000, height: 20_000 });
    // Only the headers of the blocks are read, not the colour table or the comment.
    expect(readBytes()).toBeLessThan(120);
    // Each side the larger of the two.
    expect(await sizeOf(gifBytes(300, 10, { frame: { width: 10, height: 200 } }))).toEqual({
      width: 300,
      height: 200,
    });
  });

  it('includes the first GIF frame’s left and top offsets without wrapping at 65535', async () => {
    const bytes = gifBytes(1, 1);
    bytes.set([255, 255, 255, 255], 14);
    expect(await sizeOf(bytes)).toEqual({ width: 65_536, height: 65_536 });
    const wideScreen = gifBytes(300, 10, { frame: { width: 10, height: 20 } });
    wideScreen.set([20, 0, 30, 0], 14);
    expect(await sizeOf(wideScreen)).toEqual({ width: 300, height: 50 });
  });

  it('refuses a GIF with no frame in reach, or a malformed block before it', async () => {
    const noFrame = gifBytes(300, 200).slice(0, 13);
    expect(await sizeOf(noFrame)).toBeUndefined();
    const endless = gifBytes(300, 200, { extensions: [{ label: 0xfe, data: 255 * 5000 }] });
    expect(await sizeOf(endless)).toBeUndefined();
    const cut = gifBytes(300, 200, { extensions: [{ label: 0xfe, data: 600 }] });
    expect(await sizeOf(cut.slice(0, 13 + 2 + 256 + 10))).toBeUndefined();
    const badBlock = gifBytes(300, 200);
    badBlock[13] = 0x3b;
    expect(await sizeOf(badBlock)).toBeUndefined();
  });

  it('reads a lossy, a lossless and an extended WebP', async () => {
    expect(await sizeOf(webpBytes('VP8 ', 1000, 750))).toEqual({ width: 1000, height: 750 });
    expect(await sizeOf(webpBytes('VP8L', 16_383, 2))).toEqual({ width: 16_383, height: 2 });
    expect(await sizeOf(webpBytes('VP8X', 20_000, 9000))).toEqual({ width: 20_000, height: 9000 });
  });

  it('reads a JPEG’s frame past large segments, turned upright by its EXIF orientation', async () => {
    expect(await sizeOf(jpegBytes(4000, 3000))).toEqual({ width: 4000, height: 3000 });
    // A 60 KB ICC profile and a thumbnail before the frame; orientation 6 (a quarter turn).
    const turned = jpegBytes(4000, 3000, { orientation: 6, padding: 60_000, isLittleEndian: true });
    const { read, readBytes } = counting(turned);
    expect(await readImageHeaderSize(read)).toEqual({ width: 3000, height: 4000 });
    // Only the headers and the EXIF block are read, not the padding.
    expect(readBytes()).toBeLessThan(2000);
    expect(await sizeOf(jpegBytes(4000, 3000, { orientation: 3 }))).toEqual({
      width: 4000,
      height: 3000,
    });
  });

  it('reads an AVIF’s largest ispe, turned by irot, wherever its meta box is', async () => {
    const avif = avifBytes([
      [512, 256],
      [6000, 4000],
    ]);
    expect(await sizeOf(avif)).toEqual({ width: 6000, height: 4000 });
    expect(await sizeOf(avifBytes([[6000, 4000]], { rotation: 1 }))).toEqual({
      width: 4000,
      height: 6000,
    });
    expect(await sizeOf(avifBytes([[640, 480]], { mediaFirst: 100_000 }))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('knows nothing of other or malformed bytes', async () => {
    expect(await sizeOf(new TextEncoder().encode('not an image at all'))).toBeUndefined();
    expect(await sizeOf(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeUndefined();
    expect(await sizeOf(new Uint8Array([0xff, 0xd8, 0x00]))).toBeUndefined();
    expect(await sizeOf(pngBytes(0, 10))).toBeUndefined();
    expect(await sizeOf(avifBytes([]))).toBeUndefined();
  });

  it('reads a Blob a slice at a time', async () => {
    const blob = new Blob([pngBytes(12, 34)]);
    expect(await readImageHeaderSize(blobReader(blob))).toEqual({ width: 12, height: 34 });
  });

  it('reads the other headers’ variants and refuses their malformed forms', async () => {
    const gif87 = gifBytes(3, 4);
    gif87.set([0x37], 4);
    expect(await sizeOf(gif87)).toEqual({ width: 3, height: 4 });
    const noFrameTag = webpBytes('VP8 ', 10, 10);
    noFrameTag[23] = 0;
    expect(await sizeOf(noFrameTag)).toBeUndefined();
    const noSignature = webpBytes('VP8L', 10, 10);
    noSignature[20] = 0;
    expect(await sizeOf(noSignature)).toBeUndefined();
    const otherChunk = webpBytes('VP8X', 10, 10);
    otherChunk.set([0x41, 0x4c, 0x50, 0x48], 12);
    expect(await sizeOf(otherChunk)).toBeUndefined();
    const noIhdr = pngBytes(10, 10);
    noIhdr[12] = 0;
    expect(await sizeOf(noIhdr)).toBeUndefined();
  });

  it('walks a JPEG’s fill bytes, restart markers and other segments, and stops at bad ones', async () => {
    const frame = jpegBytes(40, 30);
    // Fill bytes and a restart marker before the frame; an XMP APP1 that is not EXIF.
    const xmp = [0xff, 0xe1, 0, 6, 0x68, 0x74, 0x74, 0x70];
    const padded = new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xd0, ...xmp, ...frame.slice(2)]);
    expect(await sizeOf(padded)).toEqual({ width: 40, height: 30 });
    // A segment claiming a length under 2, and a marker byte that is not 0xff.
    expect(await sizeOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1]))).toBeUndefined();
    expect(await sizeOf(new Uint8Array([0xff, 0xd8, 0x00, 0xe0, 0, 4, 0, 0]))).toBeUndefined();
    // The end of the image before a frame.
    expect(await sizeOf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeUndefined();
  });

  it('keeps a JPEG upright without an orientation, or with a malformed EXIF block', async () => {
    // Orientation 1 (upright), big-endian.
    expect(await sizeOf(jpegBytes(40, 30, { orientation: 1 }))).toEqual({ width: 40, height: 30 });
    const noOrientation = jpegBytes(40, 30, { orientation: 6 });
    // The entry's tag is no longer the orientation's.
    const tagAt = noOrientation.indexOf(0x12, 20);
    noOrientation[tagAt] = 0x13;
    expect(await sizeOf(noOrientation)).toEqual({ width: 40, height: 30 });
    const notTiff = jpegBytes(40, 30, { orientation: 6 });
    // SOI, the APP1 marker and length, then `Exif\0\0`: the TIFF block starts at byte 12.
    const tiffAt = 12;
    notTiff.set([0x58, 0x58], tiffAt);
    expect(await sizeOf(notTiff)).toEqual({ width: 40, height: 30 });
    const truncated = jpegBytes(40, 30, { orientation: 6, isLittleEndian: true });
    // IFD0 claims two entries, the first not the orientation, and the second runs past the block.
    truncated.set([2, 0, 0x13, 0x01], tiffAt + 8);
    expect(await sizeOf(truncated)).toEqual({ width: 40, height: 30 });
  });

  it('reads an AVIF with a large box size, a meta to the end, and refuses broken boxes', async () => {
    const plain = avifBytes([[640, 480]], { rotation: 2 });
    // A half turn leaves the size as it is.
    expect(await sizeOf(plain)).toEqual({ width: 640, height: 480 });
    // The ftyp box written with a 64-bit size.
    const ftypLength = 24;
    const large = new Uint8Array(plain.length + 8);
    large.set([0, 0, 0, 1, ...plain.slice(4, 8), 0, 0, 0, 0, 0, 0, 0, ftypLength + 8]);
    large.set(plain.slice(8, ftypLength), 16);
    large.set(plain.slice(ftypLength), ftypLength + 8);
    expect(await sizeOf(large)).toEqual({ width: 640, height: 480 });
    // A meta box whose size is 0 runs to the end of the file.
    const toEnd = plain.slice();
    toEnd.set([0, 0, 0, 0], ftypLength);
    expect(await sizeOf(toEnd)).toEqual({ width: 640, height: 480 });
    // A top-level box too small to be one, and a file that is not ISO media.
    const broken = plain.slice(0, ftypLength + 8);
    broken.set([0, 0, 0, 4, 0x66, 0x72, 0x65, 0x65], ftypLength);
    expect(await sizeOf(broken)).toBeUndefined();
    const notFtyp = plain.slice();
    notFtyp.set([0x66, 0x72, 0x65, 0x65], 4);
    expect(await sizeOf(notFtyp)).toBeUndefined();
    // An item property box too small to be one ends the walk.
    const badProperty = avifBytes([[640, 480]]);
    const ispeAt = badProperty.lastIndexOf(0x69, badProperty.length - 16) - 4;
    badProperty.set([0, 0, 0, 3], ispeAt);
    expect(await sizeOf(badProperty)).toBeUndefined();
    // A file that ends inside its boxes.
    expect(await sizeOf(plain.slice(0, ftypLength + 4))).toBeUndefined();
  });

  it('gives up on a file of endless empty segments or boxes before any size', async () => {
    const segments = Array.from({ length: 1100 }, () => [0xff, 0xe0, 0, 2]).flat();
    expect(await sizeOf(new Uint8Array([0xff, 0xd8, ...segments]))).toBeUndefined();
    const ftyp = avifBytes([]).slice(0, 24);
    const boxes = Array.from({ length: 1100 }, () => [0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]).flat();
    expect(await sizeOf(new Uint8Array([...ftyp, ...boxes]))).toBeUndefined();
  });
});

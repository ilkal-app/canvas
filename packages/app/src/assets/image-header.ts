import { hasSignature, le, u16, u32 } from './image-header-bytes.js';
import { chunkedSize, isExifTurned } from './image-header-exif.js';
import type { ImagePixelSize } from './prepare-image.js';

/**
 * Reads bytes of a file: up to `length` bytes from `offset` (fewer at its end).
 *
 * @param offset - Where to start, bytes.
 * @param length - How many, bytes.
 * @returns The bytes read.
 */
export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

/** Maximum bytes read from an AVIF metadata box. */
const MAX_META_BYTES = 1024 * 1024;

/** Maximum JPEG segments or top-level ISO boxes walked. */
const MAX_SEGMENTS = 1024;

/**
 * How many GIF blocks and data sub-blocks (each a read of a byte or ten) are walked at most
 * before the first image descriptor: extensions (comments, application data) come first.
 */
const MAX_GIF_BLOCKS = 4096;

/**
 * A reader over a `Blob`: each read slices the file, so only the bytes asked for are read.
 *
 * @param blob - The file.
 * @returns The reader.
 */
export function blobReader(blob: Blob): ByteReader {
  return async (offset, length) =>
    new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer());
}

/**
 * A size, turned upright when the file says it is stored turned a quarter.
 *
 * @param width - The stored width, px.
 * @param height - The stored height, px.
 * @param isTurned - Whether it is shown turned a quarter (EXIF orientation 5–8, AVIF `irot` 1 or 3).
 * @returns The upright size, or undefined for an empty one.
 */
function upright(width: number, height: number, isTurned: boolean): ImagePixelSize | undefined {
  if (!(width > 0 && height > 0)) return undefined;
  return isTurned ? { width: height, height: width } : { width, height };
}

/**
 * The size in a PNG's `IHDR`, from the file's first bytes.
 *
 * @param head - The first 30 bytes.
 * @returns The size, or undefined when the bytes are not a PNG.
 */
function pngSize(head: Uint8Array): ImagePixelSize | undefined {
  if (!hasSignature(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return undefined;
  return hasSignature(head, 12, 'IHDR') ? upright(u32(head, 16), u32(head, 20), false) : undefined;
}

/**
 * The size a GIF decodes to (fix round 2): the larger of its logical screen and its first
 * frame including its offsets (a browser grows the canvas to fit the first frame, so a small
 * screen must not hide a huge frame from the pixel limit). Walks the blocks after the screen and its
 * colour table (extensions, a sub-block header at a time) to the first image descriptor, at most
 * `MAX_GIF_BLOCKS` of them.
 *
 * @param read - Reads the file.
 * @param head - Its first bytes (the header and logical screen).
 * @returns The size, or undefined without an image descriptor in reach or with a malformed block.
 */
async function gifSize(read: ByteReader, head: Uint8Array): Promise<ImagePixelSize | undefined> {
  const packed = head[10] ?? 0;
  const colourTable = (packed & 0x80) === 0 ? 0 : 3 * 2 ** ((packed & 0x07) + 1);
  let offset = 13 + colourTable;
  for (let block = 0; block < MAX_GIF_BLOCKS; block += 1) {
    const intro = await read(offset, 10);
    if (intro[0] === 0x2c && intro.length === 10) {
      const width = Math.max(le(head, 6, 2), le(intro, 1, 2) + le(intro, 5, 2));
      return upright(width, Math.max(le(head, 8, 2), le(intro, 3, 2) + le(intro, 7, 2)), false);
    }
    // An extension: its introducer and label, then data sub-blocks up to an empty one.
    if (intro[0] !== 0x21 || intro.length < 3) return undefined;
    offset += 2;
    let size = intro[2] ?? 0;
    while (size !== 0 && block < MAX_GIF_BLOCKS) {
      offset += 1 + size;
      block += 1;
      const next = await read(offset, 1);
      if (next.length === 0) return undefined;
      size = next[0] ?? 0;
    }
    offset += 1;
  }
  return undefined;
}

/**
 * The canvas size of a WebP (lossy `VP8 `, lossless `VP8L` or extended `VP8X`), from its first
 * bytes. Container EXIF is read separately.
 *
 * @param head - The first 30 bytes.
 * @returns The size, or undefined when the bytes are not a WebP.
 */
function webpSize(head: Uint8Array): ImagePixelSize | undefined {
  if (!hasSignature(head, 0, 'RIFF') || !hasSignature(head, 8, 'WEBP')) return undefined;
  if (hasSignature(head, 12, 'VP8 ') && hasSignature(head, 23, [0x9d, 0x01, 0x2a])) {
    return upright(le(head, 26, 2) & 0x3f_ff, le(head, 28, 2) & 0x3f_ff, false);
  }
  if (hasSignature(head, 12, 'VP8L') && head[20] === 0x2f) {
    const bits = le(head, 21, 4);
    return upright((bits & 0x3f_ff) + 1, (Math.floor(bits / 0x40_00) & 0x3f_ff) + 1, false);
  }
  if (hasSignature(head, 12, 'VP8X'))
    return upright(le(head, 24, 3) + 1, le(head, 27, 3) + 1, false);
  return undefined;
}

/**
 * Whether a JPEG marker starts a frame and carries its size (every SOFn but DHT, JPG and DAC).
 *
 * @param marker - The marker's second byte.
 * @returns True for a frame header.
 */
const isStartOfFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/**
 * A JPEG's upright size: its frame header's size, turned by its EXIF orientation, walking the
 * segments from the start (reading only each segment's header, and the EXIF block).
 *
 * @param read - Reads the file.
 * @returns The size, or undefined when it is not a JPEG or has no frame header before its scan.
 */
async function jpegSize(read: ByteReader): Promise<ImagePixelSize | undefined> {
  let offset = 2;
  let isTurned = false;
  for (let segment = 0; segment < MAX_SEGMENTS; segment += 1) {
    const head = await read(offset, 4);
    if (head.length < 2 || head[0] !== 0xff) return undefined;
    const marker = head[1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda || head.length < 4) return undefined;
    const length = u16(head, 2);
    if (length < 2) return undefined;
    if (isStartOfFrame(marker)) {
      const frame = await read(offset + 4, 5);
      return upright(u16(frame, 3), u16(frame, 1), isTurned);
    }
    if (marker === 0xe1) {
      const body = await read(offset + 4, length - 2);
      if (hasSignature(body, 0, 'Exif\0\0')) isTurned = isExifTurned(body.subarray(6));
    }
    offset += 2 + length;
  }
  return undefined;
}

/** An ISO base media box: its type, and where its body starts and it ends. */
interface IsoBox {
  readonly type: string;
  readonly bodyStart: number;
  readonly end: number;
}

/**
 * The boxes directly inside a range of bytes.
 *
 * @param bytes - The bytes.
 * @param start - Where the first box starts.
 * @param end - Where the range ends.
 * @returns The boxes, stopping at a malformed one.
 */
function boxesIn(bytes: Uint8Array, start: number, end: number): IsoBox[] {
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset + 8 <= end && boxes.length < MAX_SEGMENTS) {
    const size = u32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const boxEnd = size === 0 ? end : offset + size;
    if (size !== 0 && size < 8) break;
    boxes.push({ type, bodyStart: offset + 8, end: Math.min(boxEnd, end) });
    offset = boxEnd;
  }
  return boxes;
}

/**
 * The size of an AVIF's largest image (its `ispe` properties: the primary image or its grid,
 * never smaller than it), turned by an `irot` of a quarter or three.
 *
 * @param meta - The `meta` box's body (a full box: version and flags first).
 * @returns The size, or undefined without an `ispe`.
 */
function avifMetaSize(meta: Uint8Array): ImagePixelSize | undefined {
  const properties = boxesIn(meta, 4, meta.length)
    .filter(({ type }) => type === 'iprp')
    .flatMap((iprp) => boxesIn(meta, iprp.bodyStart, iprp.end))
    .filter(({ type }) => type === 'ipco')
    .flatMap((ipco) => boxesIn(meta, ipco.bodyStart, ipco.end));
  let width = 0;
  let height = 0;
  let isTurned = false;
  for (const { type, bodyStart } of properties) {
    if (type === 'ispe' && u32(meta, bodyStart + 4) * u32(meta, bodyStart + 8) > width * height) {
      width = u32(meta, bodyStart + 4);
      height = u32(meta, bodyStart + 8);
    }
    if (type === 'irot') isTurned = ((meta[bodyStart] ?? 0) & 1) === 1;
  }
  return upright(width, height, isTurned);
}

/**
 * An AVIF's upright size: walks the top-level boxes (reading only their headers) to `meta`,
 * reads it (at most 1 MiB) and takes its image properties.
 *
 * @param read - Reads the file.
 * @returns The size, or undefined when it is not an ISO file with an `ispe`.
 */
async function avifSize(read: ByteReader): Promise<ImagePixelSize | undefined> {
  let offset = 0;
  for (let box = 0; box < MAX_SEGMENTS; box += 1) {
    const head = await read(offset, 16);
    if (head.length < 8) return undefined;
    const size32 = u32(head, 0);
    const size = size32 === 1 ? u32(head, 8) * 0x1_00_00_00_00 + u32(head, 12) : size32;
    const headerLength = size32 === 1 ? 16 : 8;
    if (box === 0 && !hasSignature(head, 4, 'ftyp')) return undefined;
    if (hasSignature(head, 4, 'meta')) {
      const bodyLength = size === 0 ? MAX_META_BYTES : size - headerLength;
      return avifMetaSize(await read(offset + headerLength, Math.min(bodyLength, MAX_META_BYTES)));
    }
    if (size < headerLength) return undefined;
    offset += size;
  }
  return undefined;
}

/**
 * An image file's upright size from its header, without decoding it (fix round 1: a
 * decompression bomb is refused before anything decodes it): PNG `IHDR`, GIF logical screen or
 * first frame, the larger,
 * WebP `VP8 `/`VP8L`/`VP8X`, JPEG frame header (PNG/WebP/JPEG turned by EXIF), AVIF `ispe`
 * turned by `irot`. Recognised by the bytes, not the declared type. Only headers are read, a few
 * bytes at a time (EXIF metadata and an AVIF's `meta` box within a fixed byte cap). The size decides only
 * whether the page takes the file and where it is placed; the assets service reads the image
 * itself and its record is the size that is kept.
 *
 * @param read - Reads the file (`blobReader`).
 * @returns The size, or undefined when the header is not one of these or is malformed.
 */
export async function readImageHeaderSize(read: ByteReader): Promise<ImagePixelSize | undefined> {
  const head = await read(0, 30);
  const png = pngSize(head);
  if (png !== undefined) return chunkedSize(read, head, png, true);
  const webp = webpSize(head);
  if (webp !== undefined) return chunkedSize(read, head, webp, false);
  if (hasSignature(head, 0, 'GIF87a') || hasSignature(head, 0, 'GIF89a')) {
    return gifSize(read, head);
  }
  if (hasSignature(head, 0, [0xff, 0xd8])) return jpegSize(read);
  return hasSignature(head, 4, 'ftyp') ? avifSize(read) : undefined;
}

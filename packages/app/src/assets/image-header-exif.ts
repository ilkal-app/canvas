import { hasSignature, le, u16, u32 } from './image-header-bytes.js';
import type { ByteReader } from './image-header.js';
import type { ImagePixelSize } from './prepare-image.js';

/** Maximum bytes read from a container EXIF chunk. */
const MAX_META_BYTES = 1024 * 1024;

/** Maximum PNG/WebP chunks walked. */
const MAX_SEGMENTS = 1024;

/**
 * Whether an EXIF TIFF block turns the image a quarter:
 * orientation 5 to 8 in IFD0.
 *
 * @param tiff - The TIFF structure.
 * @returns True for a quarter turn.
 */
export function isExifTurned(tiff: Uint8Array): boolean {
  const isLittle = hasSignature(tiff, 0, 'II');
  if (!isLittle && !hasSignature(tiff, 0, 'MM')) return false;
  const read = (at: number, count: number): number =>
    isLittle ? le(tiff, at, count) : count === 2 ? u16(tiff, at) : u32(tiff, at);
  if (tiff.length < 8 || read(2, 2) !== 42) return false;
  const ifd = read(4, 4);
  if (ifd < 8 || ifd + 2 > tiff.length) return false;
  const entries = read(ifd, 2);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > tiff.length) return false;
    if (read(entry, 2) === 0x01_12) {
      if (read(entry + 2, 2) !== 3 || read(entry + 4, 4) !== 1) return false;
      const orientation = read(entry + 8, 2);
      return orientation >= 5 && orientation <= 8;
    }
  }
  return false;
}

/**
 * Applies PNG/WebP EXIF without reading compressed image data. PNG eXIf precedes IDAT;
 * WebP metadata may follow image data, with odd chunk lengths padded to an even boundary.
 *
 * @param read - Reads the file.
 * @param head - Its initial bytes, including the WebP RIFF size.
 * @param size - Stored pixel size.
 * @param isPng - PNG chunks instead of RIFF chunks.
 * @returns The upright size, retaining stored dimensions for absent or malformed EXIF.
 */
export async function chunkedSize(
  read: ByteReader,
  head: Uint8Array,
  size: ImagePixelSize,
  isPng: boolean,
): Promise<ImagePixelSize> {
  if (!isPng && (!hasSignature(head, 12, 'VP8X') || ((head[20] ?? 0) & 0x08) === 0)) return size;
  let offset = isPng ? 8 : 12;
  const end = isPng ? Number.MAX_SAFE_INTEGER : le(head, 4, 4) + 8;
  for (let index = 0; index < MAX_SEGMENTS && offset + 8 <= end; index += 1) {
    const chunk = await read(offset, 8);
    if (chunk.length < 8) break;
    const length = isPng ? u32(chunk, 0) : le(chunk, 4, 4);
    const typeAt = isPng ? 4 : 0;
    const next = offset + 8 + length + (isPng ? 4 : length % 2);
    if (next > end || (isPng && length > 0x7f_ff_ff_ff)) break;
    if (isPng && (hasSignature(chunk, typeAt, 'IDAT') || hasSignature(chunk, typeAt, 'IEND')))
      break;
    if (hasSignature(chunk, typeAt, isPng ? 'eXIf' : 'EXIF')) {
      if (length > MAX_META_BYTES) break;
      const body = await read(offset + 8, length);
      if (body.length !== length) break;
      const tiff = !isPng && hasSignature(body, 0, 'Exif\0\0') ? body.subarray(6) : body;
      return isExifTurned(tiff) ? { width: size.height, height: size.width } : size;
    }
    offset = next;
  }
  return size;
}

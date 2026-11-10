// Crafted image file headers for the header reader's tests (image-header.test.ts): only what the
// reader reads is real (signatures, the size fields, the EXIF orientation, the ISO boxes), the
// rest is filler.

/**
 * Bytes of Latin-1 text.
 *
 * @param text - The text.
 * @returns Its bytes.
 */
function ascii(text: string): number[] {
  return Array.from({ length: text.length }, (unused, index) => text.charCodeAt(index));
}

/**
 * A big-endian integer of `count` bytes.
 *
 * @param value - The integer.
 * @param count - How many bytes.
 * @returns The bytes.
 */
function be(value: number, count: number): number[] {
  return Array.from(
    { length: count },
    (unused, index) => Math.floor(value / 256 ** (count - 1 - index)) % 256,
  );
}

/**
 * A little-endian integer of `count` bytes.
 *
 * @param value - The integer.
 * @param count - How many bytes.
 * @returns The bytes.
 */
function le(value: number, count: number): number[] {
  return be(value, count).reverse();
}

/**
 * A PNG's signature and `IHDR`.
 *
 * @param width - The width it claims, px.
 * @param height - The height it claims, px.
 * @returns The bytes.
 */
export function pngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const header = [...be(width, 4), ...be(height, 4), 8, 6, 0, 0, 0];
  return new Uint8Array([...signature, ...be(13, 4), ...ascii('IHDR'), ...header, 0, 0, 0, 0]);
}

/** What a fixture GIF holds besides its logical screen. */
export interface GifParts {
  /** Its first frame's size, px; the screen's by default. */
  readonly frame?: { readonly width: number; readonly height: number };
  /** The bits of its global colour table's size (2 ** (bits + 1) entries); none by default. */
  readonly colourTableBits?: number;
  /** Extensions before the first frame, each a label and its data (cut into sub-blocks). */
  readonly extensions?: readonly { readonly label: number; readonly data: number }[];
}

/**
 * A GIF's header, logical screen, optional colour table and extensions, and its first frame's
 * image descriptor (then a minimal image and the trailer).
 *
 * @param width - The screen's width, px.
 * @param height - The screen's height, px.
 * @param parts - The frame, colour table and extensions.
 * @returns The bytes.
 */
export function gifBytes(
  width: number,
  height: number,
  parts: GifParts = {},
): Uint8Array<ArrayBuffer> {
  const bits = parts.colourTableBits;
  const packed = bits === undefined ? 0 : 0x80 | bits;
  const table = bits === undefined ? [] : Array.from({ length: 3 * 2 ** (bits + 1) }, () => 0);
  const extensions = (parts.extensions ?? []).flatMap(({ label, data }) => {
    const blocks: number[] = [];
    for (let left = data; left > 0; left -= 255) {
      const size = Math.min(255, left);
      blocks.push(size, ...Array.from({ length: size }, () => 0x2c));
    }
    return [0x21, label, ...blocks, 0];
  });
  const frame = parts.frame ?? { width, height };
  const descriptor = [0x2c, 0, 0, 0, 0, ...le(frame.width, 2), ...le(frame.height, 2), 0];
  return new Uint8Array([
    ...ascii('GIF89a'),
    ...le(width, 2),
    ...le(height, 2),
    packed,
    0,
    0,
    ...table,
    ...extensions,
    ...descriptor,
    2,
    1,
    0,
    0,
    0x3b,
  ]);
}

/**
 * A WebP's RIFF header and first chunk.
 *
 * @param kind - `VP8 ` (lossy), `VP8L` (lossless) or `VP8X` (extended).
 * @param width - The width, px.
 * @param height - The height, px.
 * @returns The bytes.
 */
export function webpBytes(
  kind: 'VP8 ' | 'VP8L' | 'VP8X',
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  let payload: number[];
  if (kind === 'VP8 ') payload = [0, 0, 0, 0x9d, 0x01, 0x2a, ...le(width, 2), ...le(height, 2)];
  else if (kind === 'VP8L') payload = [0x2f, ...le(width - 1 + (height - 1) * 16_384, 4)];
  else payload = [0, 0, 0, 0, ...le(width - 1, 3), ...le(height - 1, 3)];
  const chunk = [...ascii(kind), ...le(payload.length, 4), ...payload];
  return new Uint8Array([...ascii('RIFF'), ...le(4 + chunk.length, 4), ...ascii('WEBP'), ...chunk]);
}

/**
 * A JPEG segment.
 *
 * @param marker - Its marker's second byte.
 * @param body - Its body.
 * @returns The bytes.
 */
function segment(marker: number, body: readonly number[]): number[] {
  return [0xff, marker, ...be(body.length + 2, 2), ...body];
}

/**
 * An EXIF APP1 body with one IFD0 entry: the orientation.
 *
 * @param orientation - The orientation, 1 to 8.
 * @param isLittleEndian - Intel byte order rather than Motorola.
 * @returns The body.
 */
function exifBody(orientation: number, isLittleEndian: boolean): number[] {
  const int = isLittleEndian ? le : be;
  const tiff = [
    ...ascii(isLittleEndian ? 'II' : 'MM'),
    ...int(42, 2),
    ...int(8, 4),
    ...int(1, 2),
    ...int(0x01_12, 2),
    ...int(3, 2),
    ...int(1, 4),
    ...int(orientation, 2),
    0,
    0,
    ...int(0, 4),
  ];
  return [...ascii('Exif\0\0'), ...tiff];
}

/** How a crafted JPEG is laid out. */
export interface JpegLayout {
  /** Its EXIF orientation, if it has one. */
  readonly orientation?: number;
  /** Filler bytes in APP2 segments before the frame (an ICC profile). */
  readonly padding?: number;
  /** Whether the EXIF block is little-endian. */
  readonly isLittleEndian?: boolean;
}

/**
 * A JPEG's segments up to its first scan: SOI, EXIF, filler, the baseline frame header.
 *
 * @param width - The stored width, px.
 * @param height - The stored height, px.
 * @param layout - Orientation, filler and byte order.
 * @returns The bytes.
 */
export function jpegBytes(
  width: number,
  height: number,
  layout: JpegLayout = {},
): Uint8Array<ArrayBuffer> {
  const bytes = [0xff, 0xd8];
  if (layout.orientation !== undefined) {
    bytes.push(...segment(0xe1, exifBody(layout.orientation, layout.isLittleEndian ?? false)));
  }
  for (let left = layout.padding ?? 0; left > 0; left -= 60_000) {
    bytes.push(...segment(0xe2, new Array<number>(Math.min(left, 60_000)).fill(7)));
  }
  const frame = [8, ...be(height, 2), ...be(width, 2), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  bytes.push(...segment(0xc0, frame), ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]));
  return new Uint8Array(bytes);
}

/**
 * An ISO base media box.
 *
 * @param type - Its type.
 * @param body - Its body.
 * @returns The bytes.
 */
function box(type: string, body: readonly number[]): number[] {
  return [...be(body.length + 8, 4), ...ascii(type), ...body];
}

/** How a crafted AVIF is laid out. */
export interface AvifLayout {
  /** An `irot` angle (quarter turns), if any. */
  readonly rotation?: number;
  /** A media box of this many bytes before `meta`, if any. */
  readonly mediaFirst?: number;
}

/**
 * An AVIF's `ftyp` and `meta` boxes, with one `ispe` per size.
 *
 * @param sizes - The sizes, px.
 * @param layout - Rotation and box order.
 * @returns The bytes.
 */
export function avifBytes(
  sizes: readonly (readonly [number, number])[],
  layout: AvifLayout = {},
): Uint8Array<ArrayBuffer> {
  const ftyp = box('ftyp', [...ascii('avif'), 0, 0, 0, 0, ...ascii('mif1'), ...ascii('avif')]);
  const properties = sizes.map(([width, height]) =>
    box('ispe', [0, 0, 0, 0, ...be(width, 4), ...be(height, 4)]),
  );
  if (layout.rotation !== undefined) properties.push(box('irot', [layout.rotation]));
  const iprp = box('iprp', box('ipco', properties.flat()));
  const meta = box('meta', [0, 0, 0, 0, ...box('hdlr', new Array<number>(24).fill(0)), ...iprp]);
  const media =
    layout.mediaFirst === undefined
      ? []
      : box('mdat', new Array<number>(layout.mediaFirst).fill(0));
  return new Uint8Array([...ftyp, ...media, ...meta]);
}

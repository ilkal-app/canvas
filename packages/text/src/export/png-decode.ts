// A minimal PNG decoder: a bitmap colour glyph's PNG strike read into RGB samples and an
// alpha mask, as a PDF image XObject and its soft mask take them. Only what strikes use: 8-bit
// RGB or RGBA, not interlaced. The zlib stream is inflated by the platform's DecompressionStream,
// as WOFF tables are.

/** A decoded bitmap: RGB samples and, unless every pixel is opaque, an alpha mask. */
export interface DecodedBitmap {
  /** The width in pixels. */
  readonly width: number;
  /** The height in pixels. */
  readonly height: number;
  /** Three bytes a pixel, rows top to bottom. */
  readonly rgb: Uint8Array;
  /** One byte a pixel; absent when every pixel is opaque. */
  readonly alpha?: Uint8Array;
}

/** The PNG signature. */
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** The PNG signature's length. */
const SIGNATURE_BYTES = SIGNATURE.length;

/**
 * Inflates a zlib stream.
 *
 * @param bytes - The stream.
 * @returns The inflated bytes.
 */
async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The Paeth predictor.
 *
 * @param left - The byte to the left.
 * @param up - The byte above.
 * @param upLeft - The byte above and left.
 * @returns The predicted byte.
 */
function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/**
 * What a PNG row filter predicts a byte from: nothing, the left, the above, their average, or
 * Paeth's choice.
 *
 * @param filter - The filter, 0..4.
 * @param left - The byte to the left.
 * @param up - The byte above.
 * @param upLeft - The byte above and left.
 * @returns The prediction.
 */
function predictorOf(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4:
      return paeth(left, up, upLeft);
    default:
      return 0;
  }
}

/**
 * Undoes the PNG row filters (None, Sub, Up, Average, Paeth).
 *
 * @param data - The inflated scanlines, each led by its filter byte.
 * @param stride - Bytes a row, without the filter byte.
 * @param height - Rows.
 * @param bytesPerPixel - Bytes a pixel.
 * @returns The raw samples, or undefined for an unknown filter or short data.
 */
function unfilter(
  data: Uint8Array,
  stride: number,
  height: number,
  bytesPerPixel: number,
): Uint8Array | undefined {
  if (data.length < height * (stride + 1)) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = new Uint8Array(height * stride);
  const done = new DataView(out.buffer);
  for (let row = 0; row < height; row += 1) {
    const filter = view.getUint8(row * (stride + 1));
    if (filter > 4) return undefined;
    for (let column = 0; column < stride; column += 1) {
      const raw = view.getUint8(row * (stride + 1) + 1 + column);
      const at = row * stride + column;
      const hasLeft = column >= bytesPerPixel;
      const left = hasLeft ? done.getUint8(at - bytesPerPixel) : 0;
      const up = row > 0 ? done.getUint8(at - stride) : 0;
      const upLeft = row > 0 && hasLeft ? done.getUint8(at - stride - bytesPerPixel) : 0;
      done.setUint8(at, (raw + predictorOf(filter, left, up, upLeft)) & 0xff);
    }
  }
  return out;
}

/**
 * A PNG file's chunks: its header fields and its image data joined.
 *
 * @param png - The file.
 * @returns The header and data, or undefined when it is not a PNG (no signature, no header, or a
 * chunk running past the file).
 */
function chunksOf(png: Uint8Array):
  | {
      width: number;
      height: number;
      depth: number;
      colour: number;
      interlace: number;
      data: Uint8Array;
    }
  | undefined {
  if (png.length < SIGNATURE_BYTES + 25) return undefined;
  if (SIGNATURE.some((byte, index) => png[index] !== byte)) return undefined;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts: Uint8Array[] = [];
  let header: DataView | undefined;
  for (let at = SIGNATURE_BYTES; at + 8 <= png.length;) {
    const length = view.getUint32(at);
    // A chunk whose declared length runs past the file: the file is cut or forged.
    if (at + 12 + length > png.length) return undefined;
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = new DataView(body.buffer, body.byteOffset, body.byteLength);
    if (type === 'IDAT') parts.push(body);
    at += 12 + length;
  }
  if (header === undefined || header.byteLength < 13) return undefined;
  const data = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  return {
    width: header.getUint32(0),
    height: header.getUint32(4),
    ...{ depth: header.getUint8(8), colour: header.getUint8(9), interlace: header.getUint8(12) },
    data,
  };
}

/**
 * Splits interleaved samples into RGB and an alpha mask (omitted when every pixel is opaque).
 *
 * @param samples - The pixels, `channels` bytes each.
 * @param channels - 3 (RGB) or 4 (RGBA).
 * @param width - The width.
 * @param height - The height.
 * @returns The bitmap.
 */
export function splitSamples(
  samples: Uint8Array,
  channels: 3 | 4,
  width: number,
  height: number,
): DecodedBitmap {
  const pixels = width * height;
  const rgb = new Uint8Array(pixels * 3);
  const alpha = new Uint8Array(pixels);
  const view = new DataView(samples.buffer, samples.byteOffset, samples.byteLength);
  let isOpaque = true;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1)
      rgb[pixel * 3 + channel] = view.getUint8(pixel * channels + channel);
    const a = channels === 4 ? view.getUint8(pixel * 4 + 3) : 255;
    alpha[pixel] = a;
    if (a !== 255) isOpaque = false;
  }
  return isOpaque ? { width, height, rgb } : { width, height, rgb, alpha };
}

/**
 * A PNG strike decoded into RGB and alpha: 8-bit RGB or RGBA, not interlaced.
 *
 * @param png - The file.
 * @returns The bitmap, or a reason it cannot be decoded.
 */
export async function decodePng(png: Uint8Array): Promise<DecodedBitmap | string> {
  const chunks = chunksOf(png);
  if (chunks === undefined) return 'not a PNG file';
  const { width, height, depth, colour, interlace, data } = chunks;
  if (depth !== 8 || (colour !== 2 && colour !== 6))
    return `PNG colour type ${String(colour)} at depth ${String(depth)} is not supported`;
  if (interlace !== 0) return 'interlaced PNG is not supported';
  const channels = colour === 6 ? 4 : 3;
  let inflated: Uint8Array;
  try {
    inflated = await inflate(data);
  } catch {
    return 'PNG image data is malformed';
  }
  const samples = unfilter(inflated, width * channels, height, channels);
  if (samples === undefined) return 'PNG image data is malformed';
  return splitSamples(samples, channels, width, height);
}

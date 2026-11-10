/** WebGPU copies a texture into a buffer only with rows that are a multiple of 256 bytes. */
const COPY_ROW_ALIGNMENT_BYTES = 256;

/** RGBA8 and BGRA8 texels are 4 bytes. */
const BYTES_PER_PIXEL = 4;

/**
 * The canvas texel formats a WebGPU readback can come from. Chrome's preferred canvas format
 * on macOS and Windows is `bgra8unorm`.
 */
export type ReadbackFormat = 'rgba8unorm' | 'bgra8unorm';

/**
 * The row pitch of a WebGPU texture-to-buffer copy of an RGBA8 image.
 *
 * @param width - Image width in pixels.
 * @returns Bytes per row, rounded up to a multiple of 256.
 */
export function alignedBytesPerRow(width: number): number {
  const packed = width * BYTES_PER_PIXEL;
  return Math.ceil(packed / COPY_ROW_ALIGNMENT_BYTES) * COPY_ROW_ALIGNMENT_BYTES;
}

/**
 * Reverses the row order of an RGBA8 image: WebGL2's `readPixels` returns the bottom row
 * first, the backend interface returns the top row first.
 *
 * @param pixels - `width × height` RGBA8 pixels; left untouched.
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns A new array with the rows in reverse order.
 */
export function flipRows(
  pixels: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const rowBytes = width * BYTES_PER_PIXEL;
  const flipped = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const source = (height - 1 - row) * rowBytes;
    flipped.set(pixels.subarray(source, source + rowBytes), row * rowBytes);
  }
  return flipped;
}

/**
 * Turns a WebGPU texture-to-buffer copy into packed RGBA8 rows: drops each row's padding and,
 * for a `bgra8unorm` canvas, swaps red and blue.
 *
 * @param padded - The mapped copy, `height` rows of `bytesPerRow` bytes; left untouched.
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @param bytesPerRow - The copy's row pitch in bytes.
 * @param format - The canvas texel format the copy came from.
 * @returns `width × height × 4` bytes of RGBA8, top row first.
 */
export function unpackTextureReadback(
  padded: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  bytesPerRow: number,
  format: ReadbackFormat,
): Uint8Array<ArrayBuffer> {
  const rowBytes = width * BYTES_PER_PIXEL;
  const pixels = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    pixels.set(padded.subarray(row * bytesPerRow, row * bytesPerRow + rowBytes), row * rowBytes);
  }
  if (format === 'bgra8unorm') {
    for (let index = 0; index < pixels.length; index += BYTES_PER_PIXEL) {
      const blue = pixels[index] ?? 0;
      pixels[index] = pixels[index + 2] ?? 0;
      pixels[index + 2] = blue;
    }
  }
  return pixels;
}

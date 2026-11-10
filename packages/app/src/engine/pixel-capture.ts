import type { PixelRect } from '../harness/canvas-harness.js';

const BYTES_PER_PIXEL = 4;

/**
 * Copies a rectangle out of a read-back and undoes premultiplied alpha, which is how the
 * backends write the canvas (`GpuBackend.readPixels`), so the harness reports straight colour.
 *
 * @param pixels - The whole drawing buffer, RGBA8 premultiplied, top row first; not changed.
 * @param bufferWidthPx - The buffer's width, device px.
 * @param rect - The rectangle, device px, inside the buffer.
 * @returns `rect.widthPx × rect.heightPx` pixels, RGBA8, straight alpha, top row first.
 */
export function cropUnpremultiplied(
  pixels: Uint8Array,
  bufferWidthPx: number,
  rect: PixelRect,
): Uint8ClampedArray<ArrayBuffer> {
  const { xPx, yPx, widthPx, heightPx } = rect;
  const block = new Uint8ClampedArray(widthPx * heightPx * BYTES_PER_PIXEL);
  for (let row = 0; row < heightPx; row += 1) {
    const start = ((yPx + row) * bufferWidthPx + xPx) * BYTES_PER_PIXEL;
    block.set(
      pixels.subarray(start, start + widthPx * BYTES_PER_PIXEL),
      row * widthPx * BYTES_PER_PIXEL,
    );
  }
  for (let index = 0; index < block.length; index += BYTES_PER_PIXEL) {
    const alpha = block[index + 3] ?? 0;
    if (alpha === 0 || alpha === 255) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      block[index + channel] = Math.round(((block[index + channel] ?? 0) * 255) / alpha);
    }
  }
  return block;
}

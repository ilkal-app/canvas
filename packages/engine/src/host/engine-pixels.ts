/** A rectangle of the canvas's drawing buffer, device px from its top-left corner. */
export interface PixelRect {
  /** Left edge, device px; a whole number, at least 0. */
  readonly xPx: number;
  /** Top edge, device px; a whole number, at least 0. */
  readonly yPx: number;
  /** Width, device px; a whole number, at least 1. */
  readonly widthPx: number;
  /** Height, device px; a whole number, at least 1. */
  readonly heightPx: number;
}

/** A width and a height, device px. */
export interface PixelSize {
  /** Width, device px. */
  readonly widthPx: number;
  /** Height, device px. */
  readonly heightPx: number;
}

/** Pixels read back from what the engine drew: RGBA8, premultiplied, rows top to bottom. */
export interface EnginePixels extends PixelSize {
  /** `widthPx × heightPx × 4` bytes, a copy owned by the receiver. */
  readonly rgba: Uint8Array<ArrayBuffer>;
}

function isWholeAtLeast(value: number, minimum: number): boolean {
  return Number.isInteger(value) && value >= minimum;
}

/**
 * Copies a rectangle out of a whole-canvas read-back (`GpuBackend.readPixels`). Pure.
 *
 * @param pixels - The canvas's pixels, RGBA8, `size.widthPx × size.heightPx × 4` bytes, top row
 *   first; not mutated.
 * @param size - The canvas's drawing buffer size.
 * @param rect - The rectangle to copy.
 * @returns A new buffer holding only the rectangle.
 * @throws {RangeError} When `pixels` does not match `size`, or the rectangle is not whole pixels
 *   inside the canvas.
 */
export function cropPixels(
  pixels: Uint8Array<ArrayBuffer>,
  size: PixelSize,
  rect: PixelRect,
): EnginePixels {
  if (pixels.length !== size.widthPx * size.heightPx * 4) {
    throw new RangeError(
      `Read ${String(pixels.length)} bytes for a ${String(size.widthPx)}×${String(size.heightPx)} canvas.`,
    );
  }
  const { xPx, yPx, widthPx, heightPx } = rect;
  const isInside =
    isWholeAtLeast(xPx, 0) &&
    isWholeAtLeast(yPx, 0) &&
    isWholeAtLeast(widthPx, 1) &&
    isWholeAtLeast(heightPx, 1) &&
    xPx + widthPx <= size.widthPx &&
    yPx + heightPx <= size.heightPx;
  if (!isInside) {
    throw new RangeError(
      `The rectangle ${JSON.stringify(rect)} is not whole pixels inside the ${String(size.widthPx)}×${String(size.heightPx)} canvas.`,
    );
  }
  const rgba = new Uint8Array(widthPx * heightPx * 4);
  for (let row = 0; row < heightPx; row += 1) {
    const start = ((yPx + row) * size.widthPx + xPx) * 4;
    rgba.set(pixels.subarray(start, start + widthPx * 4), row * widthPx * 4);
  }
  return { widthPx, heightPx, rgba };
}

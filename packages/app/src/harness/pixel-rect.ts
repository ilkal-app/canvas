import type { PixelSize } from '../canvas/backing-store-size.js';

import type { PixelRect } from './canvas-harness.js';

/**
 * Checks that a rectangle is whole pixels inside a drawing buffer, so a pixel read never
 * returns silently clipped or resampled data.
 *
 * @param rect - The rectangle, device px.
 * @param buffer - The drawing buffer's size, device px.
 * @throws {RangeError} When the rectangle has fractional coordinates, is empty, or reaches
 *   outside the buffer.
 */
export function checkPixelRect(rect: PixelRect, buffer: PixelSize): void {
  const { xPx, yPx, widthPx, heightPx } = rect;
  const described = `${String(widthPx)}×${String(heightPx)} at (${String(xPx)}, ${String(yPx)})`;
  if (![xPx, yPx, widthPx, heightPx].every(Number.isInteger)) {
    throw new RangeError(`A pixel rectangle is whole pixels; ${described} is not.`);
  }
  if (widthPx < 1 || heightPx < 1) {
    throw new RangeError(`A pixel rectangle covers at least one pixel; ${described} does not.`);
  }
  if (xPx < 0 || yPx < 0 || xPx + widthPx > buffer.widthPx || yPx + heightPx > buffer.heightPx) {
    const size = `${String(buffer.widthPx)}×${String(buffer.heightPx)}`;
    throw new RangeError(
      `The pixel rectangle ${described} reaches outside the ${size} drawing buffer.`,
    );
  }
}

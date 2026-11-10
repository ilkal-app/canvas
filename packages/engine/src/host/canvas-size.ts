/**
 * Checks a canvas size before the engine applies it.
 *
 * @param widthPx - Drawing buffer width, device px.
 * @param heightPx - Drawing buffer height, device px.
 * @param dpr - Device pixels per CSS pixel.
 * @throws {RangeError} When the size is not positive whole pixels or the ratio not positive.
 */
export function checkCanvasSize(widthPx: number, heightPx: number, dpr: number): void {
  const isValid =
    Number.isInteger(widthPx) &&
    Number.isInteger(heightPx) &&
    widthPx > 0 &&
    heightPx > 0 &&
    Number.isFinite(dpr) &&
    dpr > 0;
  if (!isValid) {
    throw new RangeError(
      `A canvas size must be positive whole device pixels and a positive ratio, got ${String(widthPx)}×${String(heightPx)} at ${String(dpr)}.`,
    );
  }
}

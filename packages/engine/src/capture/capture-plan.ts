import type { Camera } from '../camera/camera.js';
import type { PixelSize } from '../host/engine-pixels.js';

/** The area an export draws, board units. */
export interface CaptureRect {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width; finite and above 0. */
  readonly width: number;
  /** Height; finite and above 0. */
  readonly height: number;
}

/** How large an export may be, and how large each of the windows it is drawn in. */
export interface CaptureLimits {
  /** The largest side of one tile, device px: a whole number, at least 1. */
  readonly maxTilePx: number;
  /** The largest side of the whole image, device px. */
  readonly maxEdgePx: number;
  /** The most pixels the whole image may hold. */
  readonly maxPixels: number;
}

/**
 * The default limits: tiles of at most 4096 px a side, which every WebGL2 and WebGPU device draws,
 * and an image of at most 16384 px a side and 128 MP, which a browser canvas still encodes.
 */
export const DEFAULT_CAPTURE_LIMITS: CaptureLimits = Object.freeze({
  maxTilePx: 4096,
  maxEdgePx: 16_384,
  maxPixels: 134_217_728,
});

/** One window of an export: where it sits in the image, its size, and the camera that draws it. */
export interface CaptureTile {
  /** Its left edge in the image, device px. */
  readonly xPx: number;
  /** Its top edge in the image, device px. */
  readonly yPx: number;
  /** Its width, device px. */
  readonly widthPx: number;
  /** Its height, device px. */
  readonly heightPx: number;
  /** The camera that draws exactly this window, at device pixel ratio 1. */
  readonly camera: Camera;
}

/** An export's image and the tiles it is drawn in, row by row from the top, left to right. */
export interface CapturePlan {
  /** The image's width, device px. */
  readonly widthPx: number;
  /** The image's height, device px. */
  readonly heightPx: number;
  /** Device px per board unit. */
  readonly scale: number;
  /** The tiles, covering the image once. */
  readonly tiles: readonly CaptureTile[];
}

/**
 * The size of an export's image: each side rounded up to a whole pixel, at least 1. Pure.
 *
 * @param rect - The area, board units.
 * @param scale - Device px per board unit.
 * @returns The image's size, device px.
 */
export function captureSizeOf(rect: CaptureRect, scale: number): PixelSize {
  return {
    widthPx: Math.max(1, Math.ceil(rect.width * scale)),
    heightPx: Math.max(1, Math.ceil(rect.height * scale)),
  };
}

/**
 * Whether an export of the area at the scale is within the limits: each side at most
 * `maxEdgePx`, and at most `maxPixels` in all. Pure.
 *
 * @param rect - The area, board units.
 * @param scale - Device px per board unit.
 * @param limits - The limits; the defaults if absent.
 * @returns True when it fits.
 */
export function fitsCapture(
  rect: CaptureRect,
  scale: number,
  limits: CaptureLimits = DEFAULT_CAPTURE_LIMITS,
): boolean {
  const { widthPx, heightPx } = captureSizeOf(rect, scale);
  return (
    widthPx <= limits.maxEdgePx &&
    heightPx <= limits.maxEdgePx &&
    widthPx * heightPx <= limits.maxPixels
  );
}

/**
 * Whether a number is finite and above 0.
 *
 * @param value - The number.
 * @returns True when it is.
 */
function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * The starts and lengths of the spans a length is cut into, each at most `span`.
 *
 * @param length - The whole length, px.
 * @param span - The longest span, px.
 * @returns The spans, in order.
 */
function spansOf(
  length: number,
  span: number,
): { readonly start: number; readonly size: number }[] {
  const spans: { start: number; size: number }[] = [];
  for (let start = 0; start < length; start += span) {
    spans.push({ start, size: Math.min(span, length - start) });
  }
  return spans;
}

/**
 * Plans an export: the image's size at the scale and the tiles it is drawn in, at most
 * `maxTilePx` a side, row by row from the top, the last column and row taking what is left. Each
 * tile's camera draws exactly its window. Pure; never mutates its inputs.
 *
 * @param rect - The area, board units.
 * @param scale - Device px per board unit.
 * @param limits - The limits; the defaults if absent.
 * @returns The plan.
 * @throws {RangeError} When the area or the scale is not finite and above 0, the tile size is
 *   not a whole number of at least 1, or the image does not fit the limits.
 */
export function planCapture(
  rect: CaptureRect,
  scale: number,
  limits: CaptureLimits = DEFAULT_CAPTURE_LIMITS,
): CapturePlan {
  if (!isPositive(rect.width) || !isPositive(rect.height) || !Number.isFinite(rect.x + rect.y)) {
    throw new RangeError(
      `An export's area is finite with a size above 0: ${JSON.stringify(rect)}.`,
    );
  }
  if (!isPositive(scale)) {
    throw new RangeError(`An export's scale is finite and above 0, not ${String(scale)}.`);
  }
  if (!Number.isInteger(limits.maxTilePx) || limits.maxTilePx < 1) {
    throw new RangeError(`A tile is a whole number of pixels, not ${String(limits.maxTilePx)}.`);
  }
  const { widthPx, heightPx } = captureSizeOf(rect, scale);
  if (!fitsCapture(rect, scale, limits)) {
    throw new RangeError(
      `An export of ${String(widthPx)} × ${String(heightPx)} px is over the limit of ` +
        `${String(limits.maxEdgePx)} px a side and ${String(limits.maxPixels)} px in all.`,
    );
  }
  const columns = spansOf(widthPx, limits.maxTilePx);
  const tiles = spansOf(heightPx, limits.maxTilePx).flatMap((row) =>
    columns.map((column): CaptureTile => ({
      xPx: column.start,
      yPx: row.start,
      widthPx: column.size,
      heightPx: row.size,
      camera: {
        x: rect.x + column.start / scale,
        y: rect.y + row.start / scale,
        zoom: scale,
        viewportWidthPx: column.size,
        viewportHeightPx: row.size,
        dpr: 1,
      },
    })),
  );
  return { widthPx, heightPx, scale, tiles };
}

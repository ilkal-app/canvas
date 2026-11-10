// A reference rasteriser for glyph outlines: each pixel's exact area coverage, by
// signed-area accumulation (the technique of font-rs and stb_truetype's v2 rasteriser), so small
// text drawn on the GPU can be compared with what an ideal raster would show.

import type { GlyphOutline, OutlineSegment } from '@canvas/text';

/** A glyph outline placed in a raster: its origin on the baseline and its size, in device px. */
export interface PlacedOutline {
  /** The outline, in em, y up. */
  readonly outline: GlyphOutline;
  /** The x of the glyph's origin, in device px. */
  readonly originXPx: number;
  /** The y of its baseline, in device px, from the top. */
  readonly baselineYPx: number;
  /** The font size, in device px per em. */
  readonly fontSizePx: number;
}

/** The raster's size and fill rule. */
export interface CoverageRasterOptions {
  /** Its width, in device px. */
  readonly widthPx: number;
  /** Its height, in device px. */
  readonly heightPx: number;
  /** How overlapping contours fill: non-zero, as fonts' outlines are drawn. */
  readonly fillRule: 'nonzero';
  /**
   * The most a flattened curve may stray from the curve, device px: positive and finite;
   * {@link COVERAGE_FLATTENING_TOLERANCE_PX} if absent. Large glyphs measured edge pixel by edge
   * pixel want a finer one ('s vector tier at 16× and 32×), as each chord's sagitta lands
   * in the pixels it crosses.
   */
  readonly flatteningTolerancePx?: number;
}

/** The largest distance, in device px, a flattened curve strays from the curve itself. */
export const COVERAGE_FLATTENING_TOLERANCE_PX = 1 / 32;

/** Coverage this close to 0 or 1 is that value: the accumulation's rounding, not ink. */
const SNAP = 1e-7;

/** A raster's accumulation buffer: one row of `stride` cells per pixel row. */
interface Accumulator {
  readonly cells: Float64Array;
  readonly stride: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * Each pixel's exact area coverage by positioned glyph outlines: the area of the pixel inside
 * the outlines, 0 to 1, with curves flattened to within the options' tolerance
 * ({@link COVERAGE_FLATTENING_TOLERANCE_PX} by default). Contours wound against the outer one cut holes;
 * overlapping contours wound alike count once (non-zero, clamped). Pure: the outlines are not
 * changed.
 *
 * @param outlines - The outlines, placed in device px.
 * @param options - The raster's size, fill rule and flattening tolerance.
 * @returns The coverage, row by row from the top, one value per pixel.
 * @throws {RangeError} When the tolerance is not positive and finite.
 */
export function rasterizeCoverage(
  outlines: readonly PlacedOutline[],
  options: CoverageRasterOptions,
): Float32Array {
  const { widthPx, heightPx, flatteningTolerancePx = COVERAGE_FLATTENING_TOLERANCE_PX } = options;
  if (!(Number.isFinite(flatteningTolerancePx) && flatteningTolerancePx > 0)) {
    throw new RangeError(
      `flatteningTolerancePx must be positive and finite; got ${String(flatteningTolerancePx)}.`,
    );
  }
  // Two spare cells per row: a line touching the right edge writes one and two past it.
  const stride = widthPx + 2;
  const raster: Accumulator = {
    cells: new Float64Array(stride * heightPx),
    stride,
    widthPx,
    heightPx,
  };
  for (const placed of outlines) {
    const toX = (x: number): number => placed.originXPx + x * placed.fontSizePx;
    const toY = (y: number): number => placed.baselineYPx - y * placed.fontSizePx;
    for (const contour of placed.outline.contours) {
      for (const segment of contour) flatten(segment, toX, toY, raster, flatteningTolerancePx);
    }
  }
  const coverage = new Float32Array(widthPx * heightPx);
  for (let row = 0; row < heightPx; row += 1) {
    let sum = 0;
    for (let column = 0; column < widthPx; column += 1) {
      sum += raster.cells[row * stride + column] ?? 0;
      const value = Math.min(1, Math.abs(sum));
      coverage[row * widthPx + column] = value < SNAP ? 0 : value > 1 - SNAP ? 1 : value;
    }
  }
  return coverage;
}

/**
 * Adds one outline segment to the raster as lines: a curve is cut into enough pieces that none
 * strays more than the tolerance from it.
 *
 * @param segment - The segment, in em.
 * @param toX - Maps an em x to device px.
 * @param toY - Maps an em y to device px.
 * @param raster - The accumulation buffer; changed in place (a local being built).
 * @param tolerance - The most a chord may stray from the curve, device px.
 */
function flatten(
  segment: OutlineSegment,
  toX: (x: number) => number,
  toY: (y: number) => number,
  raster: Accumulator,
  tolerance: number,
): void {
  const x0 = toX(segment.x0);
  const y0 = toY(segment.y0);
  const x1 = toX(segment.x1);
  const y1 = toY(segment.y1);
  if (segment.kind === 'line') {
    addLine(raster, x0, y0, x1, y1);
    return;
  }
  if (segment.kind === 'quadratic') {
    const cx = toX(segment.cx);
    const cy = toY(segment.cy);
    // Wang's bound: a quadratic cut into n pieces strays at most |p0 − 2c + p1| / (4n²).
    const bend = Math.hypot(x0 - 2 * cx + x1, y0 - 2 * cy + y1);
    const pieces = piecesFor(bend / 4, tolerance);
    polyline(raster, pieces, x0, y0, (t) => {
      const u = 1 - t;
      return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
    });
    return;
  }
  const c1x = toX(segment.c1x);
  const c1y = toY(segment.c1y);
  const c2x = toX(segment.c2x);
  const c2y = toY(segment.c2y);
  // Wang's bound for a cubic: 3/4 of its larger second difference over n².
  const bend = Math.max(
    Math.hypot(x0 - 2 * c1x + c2x, y0 - 2 * c1y + c2y),
    Math.hypot(c1x - 2 * c2x + x1, c1y - 2 * c2y + y1),
  );
  const pieces = piecesFor((3 / 4) * bend, tolerance);
  polyline(raster, pieces, x0, y0, (t) => {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return [a * x0 + b * c1x + c * c2x + d * x1, a * y0 + b * c1y + c * c2y + d * y1];
  });
}

/**
 * How many pieces keep a curve within the tolerance, given its error bound for one piece.
 *
 * @param errorForOne - The most a single chord strays from the curve, in device px.
 * @param tolerance - The most a chord may stray, device px.
 * @returns The number of pieces, at least 1.
 */
function piecesFor(errorForOne: number, tolerance: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(errorForOne / tolerance)));
}

/**
 * Adds a curve as `pieces` chords between evenly spaced parameters.
 *
 * @param raster - The accumulation buffer; changed in place.
 * @param pieces - The number of chords.
 * @param x0 - The curve's start x, in device px.
 * @param y0 - Its start y.
 * @param at - The curve's point at a parameter 0..1.
 */
function polyline(
  raster: Accumulator,
  pieces: number,
  x0: number,
  y0: number,
  at: (t: number) => readonly [number, number],
): void {
  let [x, y] = [x0, y0];
  for (let piece = 1; piece <= pieces; piece += 1) {
    const [nextX, nextY] = at(piece / pieces);
    addLine(raster, x, y, nextX, nextY);
    [x, y] = [nextX, nextY];
  }
}

/**
 * Adds one line's signed area to the cells of each row it crosses: in each row, the share of each
 * pixel left of the line goes to that pixel and the rest to the next, so a running sum along the
 * row is the winding-weighted coverage. Points outside the raster's sides are clamped to them,
 * which keeps the winding the line carries across the row.
 *
 * @param raster - The accumulation buffer; changed in place.
 * @param ax - The line's start x, in device px.
 * @param ay - Its start y.
 * @param bx - Its end x.
 * @param by - Its end y.
 */
function addLine(raster: Accumulator, ax: number, ay: number, bx: number, by: number): void {
  if (ay === by) return;
  const { cells, stride, widthPx, heightPx } = raster;
  const direction = ay < by ? 1 : -1;
  const [x0, y0, x1, y1] = ay < by ? [ax, ay, bx, by] : [bx, by, ax, ay];
  const dxdy = (x1 - x0) / (y1 - y0);
  const top = Math.max(0, Math.floor(y0));
  const bottom = Math.min(heightPx, Math.ceil(y1));
  for (let row = top; row < bottom; row += 1) {
    const rowTop = Math.max(row, y0);
    const rowBottom = Math.min(row + 1, y1);
    if (rowBottom <= rowTop) continue;
    const coverage = (rowBottom - rowTop) * direction;
    const fromX = clamp(x0 + (rowTop - y0) * dxdy, widthPx);
    const toX = clamp(x0 + (rowBottom - y0) * dxdy, widthPx);
    const left = Math.min(fromX, toX);
    const right = Math.max(fromX, toX);
    const base = row * stride;
    const first = Math.floor(left);
    const last = Math.ceil(right);
    if (last <= first + 1) {
      // Within one pixel: the share right of the line's mean x goes to the next pixel.
      const share = (fromX + toX) / 2 - first;
      cells[base + first] = (cells[base + first] ?? 0) + coverage * (1 - share);
      cells[base + first + 1] = (cells[base + first + 1] ?? 0) + coverage * share;
      continue;
    }
    // Across several pixels: the trapezoid's area to the right of each pixel's edge.
    const slope = 1 / (right - left);
    const firstFraction = left - first;
    const firstArea = 0.5 * slope * (1 - firstFraction) * (1 - firstFraction);
    const lastFraction = right - last + 1;
    const lastArea = 0.5 * slope * lastFraction * lastFraction;
    cells[base + first] = (cells[base + first] ?? 0) + coverage * firstArea;
    if (last === first + 2) {
      cells[base + first + 1] =
        (cells[base + first + 1] ?? 0) + coverage * (1 - firstArea - lastArea);
    } else {
      const secondArea = slope * (1.5 - firstFraction);
      cells[base + first + 1] =
        (cells[base + first + 1] ?? 0) + coverage * (secondArea - firstArea);
      for (let column = first + 2; column < last - 1; column += 1) {
        cells[base + column] = (cells[base + column] ?? 0) + coverage * slope;
      }
      const beforeLast = secondArea + (last - first - 3) * slope;
      cells[base + last - 1] =
        (cells[base + last - 1] ?? 0) + coverage * (1 - beforeLast - lastArea);
    }
    cells[base + last] = (cells[base + last] ?? 0) + coverage * lastArea;
  }
}

/**
 * An x clamped to the raster's columns, 0 to its width.
 *
 * @param x - The x, in device px.
 * @param widthPx - The raster's width.
 * @returns The clamped x.
 */
function clamp(x: number, widthPx: number): number {
  return Math.min(widthPx, Math.max(0, x));
}

/** How {@link coverageToImage} composites. */
export interface CoverageImageOptions {
  /** The image's width, in px. */
  readonly widthPx: number;
  /** Its height, in px. */
  readonly heightPx: number;
  /** The ink, sRGB bytes with alpha 0..255. */
  readonly color: readonly [number, number, number, number];
  /** The background, sRGB bytes with alpha 0..255. */
  readonly background: readonly [number, number, number, number];
  /** How coverage is blended: in linear light, encoded to sRGB. */
  readonly gamma: 'srgb';
}

/** An RGBA image, 8 bits per channel, rows from the top. */
export interface CoverageImage {
  /** Its width, in px. */
  readonly widthPx: number;
  /** Its height, in px. */
  readonly heightPx: number;
  /** Its pixels, RGBA, row by row. */
  readonly data: Uint8Array;
}

/**
 * Coverage as an image: the ink composited over the background ("over", premultiplied) in linear
 * light, by each pixel's coverage times the ink's alpha, then encoded to sRGB, as an ideal renderer
 * would blend. Pure.
 *
 * @param coverage - Each pixel's coverage, 0..1, as {@link rasterizeCoverage} gives it.
 * @param options - The size, colours and blending.
 * @returns The image.
 */
export function coverageToImage(
  coverage: Float32Array,
  options: CoverageImageOptions,
): CoverageImage {
  const { widthPx, heightPx, color, background } = options;
  const ink = [toLinear(color[0]), toLinear(color[1]), toLinear(color[2])] as const;
  const ground = [toLinear(background[0]), toLinear(background[1]), toLinear(background[2])];
  const inkAlpha = color[3] / 255;
  const groundAlpha = background[3] / 255;
  const data = new Uint8Array(widthPx * heightPx * 4);
  for (let pixel = 0; pixel < widthPx * heightPx; pixel += 1) {
    const amount = (coverage[pixel] ?? 0) * inkAlpha;
    // Porter–Duff "over" in linear light: premultiply, add, divide by the result's alpha, so a
    // transparent background lends no colour.
    const alpha = amount + groundAlpha * (1 - amount);
    for (let channel = 0; channel < 3; channel += 1) {
      const premultiplied =
        (ink[channel] ?? 0) * amount + (ground[channel] ?? 0) * groundAlpha * (1 - amount);
      const mixed = alpha === 0 ? (ground[channel] ?? 0) : premultiplied / alpha;
      data[pixel * 4 + channel] = Math.round(fromLinear(mixed) * 255);
    }
    data[pixel * 4 + 3] = Math.round(alpha * 255);
  }
  return { widthPx, heightPx, data };
}

/**
 * An sRGB byte as linear light (IEC 61966-2-1).
 *
 * @param byte - The byte, 0..255.
 * @returns Linear light, 0..1.
 */
function toLinear(byte: number): number {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * Linear light encoded as sRGB.
 *
 * @param linear - Linear light, 0..1.
 * @returns sRGB, 0..1.
 */
function fromLinear(linear: number): number {
  const value = Math.min(1, Math.max(0, linear));
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

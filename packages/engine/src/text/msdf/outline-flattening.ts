import type { CubicSegment, GlyphOutline, OutlineSegment } from '@canvas/text';

/** A straight edge in raster px, y up from the baseline. */
export interface Edge {
  /** Start x. */
  readonly x0: number;
  /** Start y. */
  readonly y0: number;
  /** End x. */
  readonly x1: number;
  /** End y. */
  readonly y1: number;
}

/** How far a flattened curve may stray from the true curve, in raster px. */
const FLATTENING_TOLERANCE_PX = 0.1;
/** The most line segments one curve (quadratic or cubic) becomes. */
const MAX_CURVE_STEPS = 64;

/**
 * Flattens a glyph outline into straight edges at a raster scale. A quadratic splits into `n`
 * chords where `n` keeps the chord error under {@link FLATTENING_TOLERANCE_PX}: the error of `n`
 * uniform steps is at most `|p0 − 2c + p1| / (8 n²)`. A cubic (CFF and CFF2 outlines)
 * takes Wang's bound for degree 3: `n = ⌈√(0.75 M / tolerance)⌉`, with `M` the larger of
 * `|p0 − 2c1 + c2|` and `|c1 − 2c2 + p1|`. Either is at most `MAX_CURVE_STEPS` chords.
 *
 * @param outline - The outline, in em units, y up.
 * @param scale - Raster px per em (the tier).
 * @returns The edges, in raster px, y up; contour order and direction are kept.
 */
export function flattenOutline(outline: GlyphOutline, scale: number): Edge[] {
  const edges: Edge[] = [];
  for (const contour of outline.contours) {
    for (const segment of contour) flattenSegment(segment, scale, edges);
  }
  return edges;
}

function flattenSegment(segment: OutlineSegment, scale: number, into: Edge[]): void {
  const x0 = segment.x0 * scale;
  const y0 = segment.y0 * scale;
  const x1 = segment.x1 * scale;
  const y1 = segment.y1 * scale;
  if (segment.kind === 'line') {
    into.push({ x0, y0, x1, y1 });
    return;
  }
  if (segment.kind === 'cubic') {
    flattenCubic(segment, scale, into);
    return;
  }
  const cx = segment.cx * scale;
  const cy = segment.cy * scale;
  const bend = Math.hypot(x0 - 2 * cx + x1, y0 - 2 * cy + y1);
  const steps = Math.min(
    MAX_CURVE_STEPS,
    Math.max(1, Math.ceil(Math.sqrt(bend / (8 * FLATTENING_TOLERANCE_PX)))),
  );
  let previousX = x0;
  let previousY = y0;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    into.push({ x0: previousX, y0: previousY, x1: x, y1: y });
    previousX = x;
    previousY = y;
  }
}

/**
 * Flattens a cubic into chords uniform in t (Wang's bound; see {@link flattenOutline}).
 *
 * @param segment - The cubic, in em.
 * @param scale - Raster px per em.
 * @param into - Receives the chords, in raster px, start to end.
 */
function flattenCubic(segment: CubicSegment, scale: number, into: Edge[]): void {
  const x0 = segment.x0 * scale;
  const y0 = segment.y0 * scale;
  const c1x = segment.c1x * scale;
  const c1y = segment.c1y * scale;
  const c2x = segment.c2x * scale;
  const c2y = segment.c2y * scale;
  const x1 = segment.x1 * scale;
  const y1 = segment.y1 * scale;
  const bend = Math.max(
    Math.hypot(x0 - 2 * c1x + c2x, y0 - 2 * c1y + c2y),
    Math.hypot(c1x - 2 * c2x + x1, c1y - 2 * c2y + y1),
  );
  const steps = Math.min(
    MAX_CURVE_STEPS,
    Math.max(1, Math.ceil(Math.sqrt((0.75 * bend) / FLATTENING_TOLERANCE_PX))),
  );
  let previousX = x0;
  let previousY = y0;
  for (let step = 1; step <= steps; step += 1) {
    // The last chord ends exactly at the end point, not at a rounded t = 1.
    if (step === steps) {
      into.push({ x0: previousX, y0: previousY, x1, y1 });
      return;
    }
    const t = step / steps;
    const u = 1 - t;
    const x = u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1;
    const y = u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1;
    into.push({ x0: previousX, y0: previousY, x1: x, y1: y });
    previousX = x;
    previousY = y;
  }
}

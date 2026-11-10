import type { Point } from '../fields/point.js';

/**
 * A cubic Bézier as its four control points: start, start handle, end handle, end, in the
 * path's own frame (world units). The prototype's `Cubic`
 * (`webgl-whiteboard/src/vector/bezier.ts`).
 */
export type Cubic = readonly [Point, Point, Point, Point];

/** Subdivision stops here even if a piece is not yet flat (a cusp can never become flat). */
const MAX_FLATTEN_DEPTH = 16;

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Whether both handles sit on their vertices, so the curve is its chord.
 *
 * @param cubic - The curve.
 * @returns True for a straight segment.
 */
export function isStraightCubic(cubic: Cubic): boolean {
  const [p0, p1, p2, p3] = cubic;
  return p0.x === p1.x && p0.y === p1.y && p2.x === p3.x && p2.y === p3.y;
}

/**
 * The point at a parameter, by the Bernstein form.
 *
 * @param cubic - The curve.
 * @param t - The parameter, 0 at the start and 1 at the end.
 * @returns The point.
 */
export function evalCubic(cubic: Cubic, t: number): Point {
  const [p0, p1, p2, p3] = cubic;
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
    y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
  };
}

/**
 * Splits a curve at a parameter by de Casteljau's construction: the halves trace the original
 * exactly.
 *
 * @param cubic - The curve.
 * @param t - Where to split, in [0, 1].
 * @returns The part before `t` and the part after it.
 */
export function splitCubic(cubic: Cubic, t: number): [Cubic, Cubic] {
  const [p0, p1, p2, p3] = cubic;
  const p01 = lerp(p0, p1, t);
  const p12 = lerp(p1, p2, t);
  const p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const middle = lerp(p012, p123, t);
  return [
    [p0, p01, p012, middle],
    [middle, p123, p23, p3],
  ];
}

function distanceToChord(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
        );
  const offsetX = point.x - (start.x + t * dx);
  const offsetY = point.y - (start.y + t * dy);
  // Math.sqrt, not Math.hypot: this runs per subdivision of every flattened curve, and hypot's
  // overflow care costs several times more in V8.
  return Math.sqrt(offsetX * offsetX + offsetY * offsetY);
}

/**
 * Flattens a curve into a polyline by adaptive subdivision (the prototype's `flattenCubic`): a
 * piece is emitted as its chord once both handles lie within `tolerance` of it, and since the
 * curve lies inside the hull of its control points, the polyline then stays within `tolerance`
 * of the curve. A straight segment gives its two end points.
 *
 * @param cubic - The curve.
 * @param tolerance - The largest allowed distance from the curve, world units, above 0.
 * @returns The polyline from the start to the end, both included; at least two points.
 */
export function flattenCubic(cubic: Cubic, tolerance: number): Point[] {
  const points: Point[] = [cubic[0]];
  const subdivide = (piece: Cubic, depth: number): void => {
    const [p0, p1, p2, p3] = piece;
    const isFlat = Math.max(distanceToChord(p1, p0, p3), distanceToChord(p2, p0, p3)) <= tolerance;
    if (isFlat || depth >= MAX_FLATTEN_DEPTH) {
      points.push(p3);
      return;
    }
    const [left, right] = splitCubic(piece, 0.5);
    subdivide(left, depth + 1);
    subdivide(right, depth + 1);
  };
  subdivide(cubic, 0);
  return points;
}

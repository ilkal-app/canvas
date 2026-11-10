import type { Point } from '../fields/point.js';
import type { FreehandObject } from '../objects/freehand-object.js';

import { flattenCubic, type Cubic } from './bezier.js';
import { freehandPointsOf } from './freehand-samples.js';

// The smooth curve through a freehand stroke's stored points: a centripetal
// Catmull–Rom spline (alpha 0.5), which passes through every point and never forms a cusp or a
// self-intersecting loop inside one segment, converted to cubic Béziers (Yuksel, Schaefer and
// Keyser, "Parameterization and applications of Catmull–Rom curves", 2011). The ends take their
// tangents from points reflected through the first and last points. Everything that reads a
// stroke's shape (bounds, hit-testing, the engine's outline) reads this one curve.

/** One cubic piece of a freehand curve: from a stored point to the next, with two handles. */
export interface FreehandSegment {
  /** The stored point the piece starts at. */
  readonly from: Point;
  /** The handle leaving `from`. */
  readonly c1: Point;
  /** The handle arriving at `to`. */
  readonly c2: Point;
  /** The next stored point, where the piece ends. */
  readonly to: Point;
}

/** A stroke's bounds in its own frame (the same shape as the schema's `Rect`), world units. */
export interface FreehandBounds {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width, at least 0. */
  readonly width: number;
  /** Height, at least 0. */
  readonly height: number;
}

/** The flattening tolerance of hit-testing and bounds, world units. */
export const FREEHAND_FLATTEN_TOLERANCE = 0.25;

/** The Catmull–Rom parameterization: 0.5 is centripetal. */
const ALPHA = 0.5;

/**
 * The point at an index the caller knows is in range.
 *
 * @param points - The points.
 * @param index - The index, in range.
 * @returns The point.
 * @throws {RangeError} When the index is out of range, which the callers never pass.
 */
function pointAt(points: readonly Point[], index: number): Point {
  const point = points[index];
  if (point === undefined) throw new RangeError(`No point at ${String(index)}.`);
  return point;
}

/**
 * The knot interval between two points: their distance to the power {@link ALPHA}.
 *
 * @param a - One point.
 * @param b - The other.
 * @returns The interval; 0 for equal points.
 */
function knot(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y) ** ALPHA;
}

/**
 * The handle leaving `p1` toward `p2` of the Catmull–Rom piece with `p0` before it. Where `p0`
 * coincides with `p1` the tangent has no direction, so the handle sits on the chord at a third.
 *
 * @param p0 - The point before.
 * @param p1 - The piece's start.
 * @param p2 - The piece's end.
 * @returns The handle.
 */
function handle(p0: Point, p1: Point, p2: Point): Point {
  const d1 = knot(p0, p1);
  const d2 = knot(p1, p2);
  if (d1 === 0 || d2 === 0) return { x: p1.x + (p2.x - p1.x) / 3, y: p1.y + (p2.y - p1.y) / 3 };
  const a = d1 * d1;
  const b = d2 * d2;
  const middle = 2 * a + 3 * d1 * d2 + b;
  const scale = 3 * d1 * (d1 + d2);
  return {
    x: (a * p2.x - b * p0.x + middle * p1.x) / scale,
    y: (a * p2.y - b * p0.y + middle * p1.y) / scale,
  };
}

/**
 * The cubic pieces of a stroke's curve: a centripetal Catmull–Rom spline through every stored
 * point, piece `i` running from point `i` to point `i + 1`. Two points give one straight piece
 * with its handles on the chord at a third and two thirds. Pure.
 *
 * @param flat - The stroke's flat x, y pairs.
 * @returns The pieces; none for a single point.
 */
export function freehandCurve(flat: readonly number[]): FreehandSegment[] {
  const points = freehandPointsOf(flat);
  const count = points.length;
  if (count < 2) return [];
  if (count === 2) {
    const from = pointAt(points, 0);
    const to = pointAt(points, 1);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const c1 = { x: from.x + dx / 3, y: from.y + dy / 3 };
    const c2 = { x: from.x + (2 * dx) / 3, y: from.y + (2 * dy) / 3 };
    return [{ from, c1, c2, to }];
  }
  const at = (index: number): Point => {
    if (index < 0) return reflect(pointAt(points, 0), pointAt(points, 1));
    if (index >= count) return reflect(pointAt(points, count - 1), pointAt(points, count - 2));
    return pointAt(points, index);
  };
  const segments: FreehandSegment[] = [];
  for (let index = 0; index + 1 < count; index += 1) {
    const before = at(index - 1);
    const from = at(index);
    const to = at(index + 1);
    const after = at(index + 2);
    segments.push({ from, c1: handle(before, from, to), c2: handle(after, to, from), to });
  }
  return segments;
}

/**
 * A point reflected through another.
 *
 * @param mirror - The point reflected through.
 * @param point - The point reflected.
 * @returns `2 · mirror − point`.
 */
function reflect(mirror: Point, point: Point): Point {
  return { x: 2 * mirror.x - point.x, y: 2 * mirror.y - point.y };
}

/**
 * The curve flattened into a polyline within `tolerance` of it, from the first stored point to
 * the last. Pure.
 *
 * @param points - The stroke's flat x, y pairs.
 * @param tolerance - The largest distance from the curve, world units, above 0.
 * @returns The polyline as flat x, y pairs; the point itself for a single point.
 */
export function flattenFreehand(points: readonly number[], tolerance: number): number[] {
  const segments = freehandCurve(points);
  const [first] = segments;
  if (first === undefined) return points.slice(0, 2);
  const flat: number[] = [first.from.x, first.from.y];
  for (const { from, c1, c2, to } of segments) {
    const cubic: Cubic = [from, c1, c2, to];
    for (const point of flattenCubic(cubic, tolerance).slice(1)) flat.push(point.x, point.y);
  }
  return flat;
}

/**
 * The distance from a point to the segment between two others.
 *
 * @param point - The point.
 * @param from - The segment's start.
 * @param to - The segment's end.
 * @returns The distance.
 */
function segmentDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
}

/**
 * The distance from a point in the stroke's frame to its centre line, flattened within
 * {@link FREEHAND_FLATTEN_TOLERANCE}: what hit-testing compares with half the drawn width plus
 * the pointer's slop. Pure.
 *
 * @param points - The stroke's flat x, y pairs.
 * @param local - The point, in the stroke's own frame.
 * @returns The distance, world units; to the point itself for a one-point stroke.
 */
export function freehandCenterDistance(points: readonly number[], local: Point): number {
  const line = freehandPointsOf(flattenFreehand(points, FREEHAND_FLATTEN_TOLERANCE));
  let nearest = Number.POSITIVE_INFINITY;
  line.forEach((point, index) => {
    const from = line[index - 1] ?? point;
    nearest = Math.min(nearest, segmentDistance(local, from, point));
  });
  return nearest;
}

/**
 * A stroke's bounds in its own frame: the box around its flattened curve, grown by half the
 * stroke width on every side, so the box holds the ink (a dot is a square of the width). Pure.
 *
 * @param freehand - The stroke's points, pressures and stroke.
 * @returns The bounds, world units.
 */
export function freehandLocalBounds(
  freehand: Pick<FreehandObject, 'points' | 'pressures' | 'stroke'>,
): FreehandBounds {
  const line = freehandPointsOf(flattenFreehand(freehand.points, FREEHAND_FLATTEN_TOLERANCE));
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { x, y } of line) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (minX > maxX) return { x: 0, y: 0, width: 0, height: 0 };
  const half = freehand.stroke.width / 2;
  return {
    x: minX - half,
    y: minY - half,
    width: maxX - minX + 2 * half,
    height: maxY - minY + 2 * half,
  };
}

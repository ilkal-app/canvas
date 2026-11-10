// COLRv1 gradients as canvas gradients: the linear gradient's p2 projection, the radial
// gradient's two circles over the written-out parameter range, and the sweep as a conic gradient.

import type {
  ColourGlyphLinear,
  ColourGlyphRadial,
  ColourGlyphStop,
  ColourGlyphSweep,
} from '@canvas/text';

import type { ColourContext2d, ColourGradient } from './colour-canvas.js';
import { cssColour, paramRange, stopsOver, type ParamStop } from './colour-stops.js';

/** A full turn, in radians. */
const TURN = 2 * Math.PI;

/** A point in the gradient's own coordinates, em. */
export interface CoverPoint {
  /** x. */
  readonly x: number;
  /** y. */
  readonly y: number;
}

/**
 * The point a share t of the way from a to b, exact at both ends.
 *
 * @param a - The value at t = 0.
 * @param b - The value at t = 1.
 * @param t - The share.
 * @returns The interpolated value.
 */
function lerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

/**
 * Where a COLRv1 linear gradient ends: p1 projected onto the line through p0 perpendicular to
 * p0p2 (the OpenType COLR specification's p3).
 *
 * @param op - The gradient.
 * @returns The end point, in em.
 */
export function linearEnd(op: ColourGlyphLinear): { readonly x: number; readonly y: number } {
  const px = -(op.y2 - op.y0);
  const py = op.x2 - op.x0;
  const length = px * px + py * py;
  if (length === 0) return { x: op.x1, y: op.y1 };
  const k = ((op.x1 - op.x0) * px + (op.y1 - op.y0) * py) / length;
  return { x: op.x0 + px * k, y: op.y0 + py * k };
}

/**
 * A linear gradient's parameter at a point: its projection onto p0 → the projected end.
 *
 * @param op - The gradient.
 * @returns The parameter at a point, NaN everywhere for a gradient of no length.
 */
export function linearParameter(op: ColourGlyphLinear): (p: CoverPoint) => number {
  const end = linearEnd(op);
  const dx = end.x - op.x0;
  const dy = end.y - op.y0;
  const length = dx * dx + dy * dy;
  return (p) => (length === 0 ? Number.NaN : ((p.x - op.x0) * dx + (p.y - op.y0) * dy) / length);
}

/**
 * Adds stops at their positions along the written-out range.
 *
 * @param gradient - The canvas gradient.
 * @param stops - The stops over the range.
 * @param from - The range's start.
 * @param to - The range's end.
 */
function addStops(
  gradient: ColourGradient,
  stops: readonly ParamStop[],
  from: number,
  to: number,
): void {
  for (const stop of stops)
    gradient.addColorStop((stop.t - from) / (to - from), cssColour(stop.color));
}

/**
 * A linear gradient: p0 to the projected end, stretched to the written-out range, which for
 * repeat and reflect reaches the parameters needed.
 *
 * @param context - The canvas.
 * @param op - The gradient.
 * @param need - The lowest and highest parameters the canvas shows, when known.
 * @returns The canvas gradient.
 */
export function linearGradient(
  context: ColourContext2d,
  op: ColourGlyphLinear,
  need?: readonly [number, number],
): ColourGradient {
  const end = linearEnd(op);
  const [from, to] = paramRange(op.stops, op.extend, need);
  const at = (t: number): readonly [number, number] => [
    lerp(op.x0, end.x, t),
    lerp(op.y0, end.y, t),
  ];
  const [x0, y0] = at(from);
  const [x1, y1] = at(to);
  const gradient = context.createLinearGradient(x0, y0, x1, y1);
  addStops(gradient, stopsOver(op.stops, op.extend, from, to), from, to);
  return gradient;
}

/**
 * A two-circle radial gradient over the written-out range, starting no earlier than where the
 * radius reaches zero (a canvas refuses a negative radius); for repeat and reflect the range
 * reaches the parameters needed.
 *
 * @param context - The canvas.
 * @param op - The gradient.
 * @param need - The lowest and highest parameters the canvas shows, when known.
 * @returns The canvas gradient.
 */
export function radialGradient(
  context: ColourContext2d,
  op: ColourGlyphRadial,
  need?: readonly [number, number],
): ColourGradient {
  const growth = op.r1 - op.r0;
  const [range0, to] = paramRange(op.stops, op.extend, need);

  const zeroAt = growth > 0 ? -op.r0 / growth : -Infinity;
  const from = Math.max(range0, zeroAt);
  const circle = (t: number): readonly [number, number, number] => [
    lerp(op.x0, op.x1, t),
    lerp(op.y0, op.y1, t),
    Math.max(0, lerp(op.r0, op.r1, t)),
  ];
  const [x0, y0, r0] = circle(from);
  const [x1, y1, r1] = circle(to);
  const gradient = context.createRadialGradient(x0, y0, r0, x1, y1, r1);
  addStops(gradient, stopsOver(op.stops, op.extend, from, to), from, to);
  return gradient;
}

/**
 * The parameter of the largest circle of a two-circle gradient through a point: the larger root
 * t of |p − c(t)| = r(t) with r(t) ≥ 0, as the canvas paints it.
 *
 * @param op - The gradient.
 * @param p - The point.
 * @returns The parameter, or NaN where no circle reaches the point.
 */
export function radialParameter(op: ColourGlyphRadial, p: CoverPoint): number {
  const cx = op.x1 - op.x0;
  const cy = op.y1 - op.y0;
  const dr = op.r1 - op.r0;
  const qx = p.x - op.x0;
  const qy = p.y - op.y0;
  const a = cx * cx + cy * cy - dr * dr;
  const b = -2 * (qx * cx + qy * cy + op.r0 * dr);
  const c = qx * qx + qy * qy - op.r0 * op.r0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (b !== 0) roots.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
    }
  }
  const valid = roots.filter((t) => op.r0 + dr * t >= 0);
  return valid.length === 0 ? Number.NaN : Math.max(...valid);
}

/**
 * A sweep gradient as a conic gradient from the start angle. COLRv1 takes each angle α in 0..2π
 * from +x to the parameter (α − start)/(end − start); the conic's share of the turn is α's
 * distance past the start angle, so α from the start (taken into 0..2π) to 2π comes first and α
 * from 0 back up to it wraps after, with a hard edge where they meet at α = 0. Under the
 * y-flipped base transform the canvas's clockwise is the font's counter-clockwise, as COLRv1
 * sweeps.
 *
 * @param context - The canvas.
 * @param op - The gradient.
 * @returns The canvas gradient.
 */
export function sweepGradient(context: ColourContext2d, op: ColourGlyphSweep): ColourGradient {
  const gradient = context.createConicGradient(op.startAngle, op.x0, op.y0);
  const sweep = op.endAngle - op.startAngle;
  if (sweep === 0) {
    const color = op.stops[0]?.color ?? { r: 0, g: 0, b: 0, a: 0 };
    gradient.addColorStop(0, cssColour(color));
    gradient.addColorStop(1, cssColour(color));
    return gradient;
  }
  const start = ((op.startAngle % TURN) + TURN) % TURN;
  const stops = [
    ...sweepSegment(op, start, TURN, -start),
    ...(start > 0 ? sweepSegment(op, 0, start, TURN - start) : []),
  ].sort((a, b) => a.position - b.position);
  for (const stop of stops) {
    gradient.addColorStop(Math.min(1, Math.max(0, stop.position)), cssColour(stop.color));
  }
  return gradient;
}

/**
 * The stops of a sweep over one span of angles, at their shares of the conic's turn, in share
 * order (a coincident pair kept in the order the angle meets them).
 *
 * @param op - The gradient.
 * @param from - The span's first angle, in 0..2π.
 * @param to - Its last angle, past `from`.
 * @param shift - What takes an angle in the span to its distance past the conic's start.
 * @returns The stops.
 */
function sweepSegment(
  op: ColourGlyphSweep,
  from: number,
  to: number,
  shift: number,
): { readonly position: number; readonly color: ColourGlyphStop['color'] }[] {
  const sweep = op.endAngle - op.startAngle;
  const [t0, t1] = [(from - op.startAngle) / sweep, (to - op.startAngle) / sweep];
  const stops = stopsOver(op.stops, op.extend, Math.min(t0, t1), Math.max(t0, t1)).map((stop) => ({
    position: (op.startAngle + stop.t * sweep + shift) / TURN,
    color: stop.color,
  }));
  return sweep > 0 ? stops : stops.reverse();
}

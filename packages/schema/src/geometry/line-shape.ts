import type { LineCap } from '../fields/line-cap.js';
import type { Point } from '../fields/point.js';

import { capShaftInset, capShaftStyle, capShapeOf, type CapShape } from './caps.js';
import type { StrokeCapStyle, StrokeCaps } from './stroke-caps.js';
import { PLAIN_OUTLINE, type StrokeOutline } from './stroke-outline.js';

/** What a line draws, in its own frame: its shaft, stroked, and a head per capped end. */
export interface LineShape {
  /** The stroked centre line: the route, each end pulled back under a filled cap that needs it. */
  readonly shaft: readonly Point[];
  /** The shaft's stroke cap at each end (`capShaftStyle`). */
  readonly shaftCaps: StrokeCaps;
  /** The caps' shapes, start first; none for `none` caps or a route of one point. */
  readonly heads: readonly CapShape[];
}

/** What a line's shape is built from: its route and caps. */
export interface LineShapeInput {
  /** The centre line (`lineRouteOf`), in the line's own frame. */
  readonly route: readonly Point[];
  /** The cap at the route's first point. */
  readonly startCap: LineCap;
  /** The cap at its last point. */
  readonly endCap: LineCap;
  /**
   * The shaft's join, dash and cap: the cap ends an end without a decoration and every
   * dash; absent for none (round joins and ends, solid).
   */
  readonly outline?: StrokeOutline | undefined;
}

/**
 * The shaft's stroke cap at one end: the decoration's shaft end (`capShaftStyle`) under a
 * decoration, else the outline's cap, round by default.
 *
 * @param cap - The end's decoration.
 * @param outline - The line's outline.
 * @returns The end's stroke cap.
 */
function shaftEndStyle(cap: LineCap, outline: StrokeOutline): StrokeCapStyle {
  return cap === 'none' ? (outline.cap ?? capShaftStyle(cap)) : capShaftStyle(cap);
}

/** An end of a route and the unit direction out of the line there. */
interface RouteEnd {
  readonly tip: Point;
  readonly outward: Point;
  /** The length of the piece that ends there. */
  readonly pieceLength: number;
}

/**
 * The end of a route: its last point, and the direction from the nearest earlier point that
 * differs from it.
 *
 * @param points - The route, read from the end being asked about.
 * @returns The end, or `undefined` when every point is the same.
 */
function routeEnd(points: readonly Point[]): RouteEnd | undefined {
  const tip = points.at(-1);
  if (!tip) return undefined;
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const from = points[index];
    if (!from) continue;
    const length = Math.hypot(tip.x - from.x, tip.y - from.y);
    if (length > 0) {
      const outward = { x: (tip.x - from.x) / length, y: (tip.y - from.y) / length };
      return { tip, outward, pieceLength: length };
    }
  }
  return undefined;
}

/**
 * A route's end point moved back along its last piece, at most to the piece's start.
 *
 * @param end - The end.
 * @param inset - How far back, world units.
 * @returns The new end point.
 */
function pulledBack(end: RouteEnd, inset: number): Point {
  const by = Math.min(inset, end.pieceLength);
  return { x: end.tip.x - end.outward.x * by, y: end.tip.y - end.outward.y * by };
}

/**
 * The length of a route: the sum of its pieces.
 *
 * @param route - The route.
 * @returns Its length, world units.
 */
function routeLength(route: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    if (from && to) length += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return length;
}

/**
 * The shape of a line: its shaft, the route with each
 * end pulled back under a cap that covers it (`capShaftInset`), stroked with round or butt ends
 * (`capShaftStyle`, the `capStyle` hook; an end without a decoration takes the outline's
 * cap), and each capped end's head (`capShapeOf`), sized by
 * the stroke width and at most half the route's length each (`capLengthOn`), so the heads of a
 * short line never overshoot its far end. A route whose points all coincide has no heads (there
 * is no direction to point them) and draws as a round dot the size of its stroke. Pure.
 *
 * @param input - The route and caps; not mutated.
 * @param width - The stroke width, world units.
 * @returns The shaft and heads.
 */
export function lineShapeOf(input: LineShapeInput, width: number): LineShape {
  const { route, startCap, endCap, outline = PLAIN_OUTLINE } = input;
  const reversed = [...route].reverse();
  const start = routeEnd(reversed);
  const end = routeEnd(route);
  const heads: CapShape[] = [];
  const shaft = [...route];
  if (start && end) {
    const length = routeLength(route);
    const startHead = capShapeOf(startCap, start.tip, start.outward, width, length);
    const endHead = capShapeOf(endCap, end.tip, end.outward, width, length);
    if (startHead) heads.push(startHead);
    if (endHead) heads.push(endHead);
    shaft[0] = pulledBack(start, capShaftInset(startCap, width, length));
    shaft[shaft.length - 1] = pulledBack(end, capShaftInset(endCap, width, length));
  }
  // A line whose ends coincide (two people moved its ends onto one point at once) has no length
  // and no direction for its heads. Its shaft reduces to one point, which `writeStroke` draws as
  // a round dot the size of its stroke only with round ends, so both ends are round whatever the
  // caps. Picking it is hit testing's part: `distanceToPolylines` measures a one-point polyline
  // to that point. Its end handles then pull it apart.
  const shaftCaps: StrokeCaps =
    start && end
      ? { start: shaftEndStyle(startCap, outline), end: shaftEndStyle(endCap, outline) }
      : { start: 'round', end: 'round' };
  return { shaft, shaftCaps, heads };
}

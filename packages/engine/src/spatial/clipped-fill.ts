import type { Point } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';

import { clipPolygon, clipSegment, type ClipRect } from './clip-chain.js';
import { isInsideEvenOdd, segmentMeetsBounds } from './segment-math.js';

// What a clip chain leaves of an even-odd fill, in exact geometry rather than by
// sampling. The chain's region C (the intersection of its boxes) is convex, so the visible fill
// V = F ∩ C is bounded by two kinds of segment: the fill's own edges cut to C (`clipSegment`),
// and the runs of C's outline that lie in the fill (each edge of C split where fill edges cross
// it, a run kept when its midpoint is inside the fill). A marquee meets V when a cut fill edge
// meets it, or, failing that, when the marquee's own visible part K = marquee ∩ C (convex) lies
// in the fill: with no fill edge inside K, K is wholly in or wholly out of the fill, so one
// interior point of K decides. A marquee (convex) encloses V exactly when it encloses V's
// boundary.

/**
 * The corners of a clip chain's region: its innermost box cut by the rest of the chain.
 *
 * @param chain - The chain, not empty.
 * @returns The region's corners in the world, in order round it; empty when nothing is left.
 */
function clipRegionOf(chain: readonly ClipRect[]): Point[] {
  const [inner] = chain;
  if (inner === undefined) return [];
  const { x, y, cos, sin, width, height } = inner;
  const at = (localX: number, localY: number): Point => ({
    x: x + cos * localX - sin * localY,
    y: y + sin * localX + cos * localY,
  });
  return clipPolygon([at(0, 0), at(width, 0), at(width, height), at(0, height)], chain.slice(1));
}

/**
 * Each edge of a fill's loops, in the world.
 *
 * @param fillPolygons - The fill's closed loops.
 * @returns The edges.
 */
function edgesOf(fillPolygons: readonly (readonly Point[])[]): (readonly [Point, Point])[] {
  const edges: (readonly [Point, Point])[] = [];
  for (const polygon of fillPolygons) {
    let start: Point | undefined;
    for (const end of polygon) {
      if (start !== undefined) edges.push([start, end]);
      start = end;
    }
  }
  return edges;
}

/**
 * Where a segment crosses another, as a parameter along the first.
 *
 * @param from - The first segment's start.
 * @param to - Its end.
 * @param edge - The other segment.
 * @returns The parameter in [0, 1] along the first, or undefined when they do not cross (or are
 *   parallel).
 */
function crossingOn(from: Point, to: Point, edge: readonly [Point, Point]): number | undefined {
  const [a, b] = edge;
  const rx = to.x - from.x;
  const ry = to.y - from.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return undefined;
  const qx = a.x - from.x;
  const qy = a.y - from.y;
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : undefined;
}

/**
 * The boundary of what a clip chain leaves of an even-odd fill: the fill's edges cut by the
 * chain, and the runs of the chain region's outline that lie in the fill. Empty exactly when
 * nothing of the fill shows. Pure.
 *
 * @param fillPolygons - The fill's closed loops, world units; not mutated.
 * @param chain - The clip chain (`clipChainOf`), not empty.
 * @returns The boundary's segments.
 */
export function clippedFillBoundary(
  fillPolygons: readonly (readonly Point[])[],
  chain: readonly ClipRect[],
): (readonly [Point, Point])[] {
  const edges = edgesOf(fillPolygons);
  if (edges.length === 0) return [];
  const boundary: (readonly [Point, Point])[] = [];
  for (const [start, end] of edges) {
    const piece = clipSegment(start, end, chain);
    if (piece !== undefined) boundary.push(piece);
  }
  const region = clipRegionOf(chain);
  region.forEach((from, index) => {
    const to = region[(index + 1) % region.length] ?? from;
    const at = (t: number): Point => ({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    });
    const cuts = [0, 1];
    for (const edge of edges) {
      const t = crossingOn(from, to, edge);
      if (t !== undefined) cuts.push(t);
    }
    cuts.sort((first, second) => first - second);
    for (let cut = 1; cut < cuts.length; cut++) {
      const t0 = cuts[cut - 1] ?? 0;
      const t1 = cuts[cut] ?? 1;
      if (t1 > t0 && isInsideEvenOdd(fillPolygons, at((t0 + t1) / 2))) {
        boundary.push([at(t0), at(t1)]);
      }
    }
  });
  return boundary;
}

/**
 * Whether a marquee meets what a clip chain leaves of an even-odd fill, edges included. Pure.
 *
 * @param fillPolygons - The fill's closed loops, world units; not mutated.
 * @param chain - The clip chain (`clipChainOf`), not empty.
 * @param rect - The marquee, world units.
 * @returns True when some visible point of the fill is in the marquee.
 */
export function clippedFillMeetsBounds(
  fillPolygons: readonly (readonly Point[])[],
  chain: readonly ClipRect[],
  rect: WorldBounds,
): boolean {
  if (fillPolygons.length === 0) return false;
  const shown = clipPolygon(
    [
      { x: rect.minX, y: rect.minY },
      { x: rect.maxX, y: rect.minY },
      { x: rect.maxX, y: rect.maxY },
      { x: rect.minX, y: rect.maxY },
    ],
    chain,
  );
  if (shown.length === 0) return false;
  for (const [start, end] of edgesOf(fillPolygons)) {
    const piece = clipSegment(start, end, chain);
    if (piece !== undefined && segmentMeetsBounds(piece[0], piece[1], rect)) return true;
  }
  // No fill edge enters the marquee's visible part, so it is all fill or none: its centroid
  // (inside it, being convex) decides.
  const centroid = shown.reduce(
    (sum, { x, y }) => ({ x: sum.x + x / shown.length, y: sum.y + y / shown.length }),
    { x: 0, y: 0 },
  );
  return isInsideEvenOdd(fillPolygons, centroid);
}

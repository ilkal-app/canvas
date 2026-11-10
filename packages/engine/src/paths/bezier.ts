import { evalCubic, type Cubic, type Point, type Segment, type Vertex } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';

export { evalCubic, flattenCubic, isStraightCubic, splitCubic } from '@canvas/schema';
export type { Cubic } from '@canvas/schema';

/** What {@link cubicOf} needs from a network: its vertices by id. */
export interface VertexLookup {
  /** Every vertex of the network, by id. */
  readonly vertexById: ReadonlyMap<string, Vertex>;
}

/** The nearest point of a curve to a query point. */
export interface NearestOnCubic {
  /** The curve parameter of the nearest point, in [0, 1]. */
  readonly t: number;
  /** The nearest point. */
  readonly point: Point;
  /** Its distance from the query point. */
  readonly distance: number;
}

/** Samples of the coarse pass of {@link nearestOnCubic}. */
const NEAREST_COARSE_SAMPLES = 64;

/** Ternary-search steps refining each local minimum of the coarse pass. */
const NEAREST_REFINE_STEPS = 24;

/** Below this, a derivative coefficient counts as zero. */
const EPSILON = 1e-12;

/**
 * The curve a segment draws: its end vertices and their handles (the handle offsets are added
 * to the vertices, as the schema's `segmentSchema` says).
 *
 * @param network - The segment's network, its vertices by id.
 * @param segment - The segment.
 * @returns The segment's cubic, from vertex `a` to vertex `b`.
 * @throws {RangeError} When an end vertex is missing (a network `findNetworkIssues` rejects).
 */
export function cubicOf(network: VertexLookup, segment: Segment): Cubic {
  const start = network.vertexById.get(segment.a);
  const end = network.vertexById.get(segment.b);
  if (!start || !end) {
    throw new RangeError(`Segment "${segment.id}" references a missing vertex.`);
  }
  return [
    { x: start.x, y: start.y },
    { x: start.x + segment.ha.x, y: start.y + segment.ha.y },
    { x: end.x + segment.hb.x, y: end.y + segment.hb.y },
    { x: end.x, y: end.y },
  ];
}

/**
 * The parameters in (0, 1) where one coordinate of a curve has a zero derivative: the roots of
 * `a t² + b t + c`, the derivative's Bernstein form divided by 3.
 *
 * @param p0 - The coordinate of the start.
 * @param p1 - The coordinate of the start handle.
 * @param p2 - The coordinate of the end handle.
 * @param p3 - The coordinate of the end.
 * @returns The parameters, at most two.
 */
function extremaOf(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < EPSILON) {
    if (Math.abs(b) > EPSILON) roots.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

/**
 * The tight bounds of a curve: its end points and the points where either coordinate turns,
 * not the looser hull of its control points.
 *
 * @param cubic - The curve.
 * @returns The smallest box containing it, world units.
 */
export function cubicBounds(cubic: Cubic): WorldBounds {
  const [p0, p1, p2, p3] = cubic;
  const parameters = [
    0,
    1,
    ...extremaOf(p0.x, p1.x, p2.x, p3.x),
    ...extremaOf(p0.y, p1.y, p2.y, p3.y),
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const t of parameters) {
    const { x, y } = evalCubic(cubic, t);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * The point of a curve nearest a query point. The curve is sampled coarsely and every local
 * minimum of the samples is refined by ternary search, not just the best one: a curve that
 * loops back has several local minima, and refining only the best coarse sample can lock onto
 * the wrong one (a fix carried over from the prototype's pen tool).
 *
 * @param cubic - The curve.
 * @param point - The query point.
 * @returns The nearest point, its parameter and its distance.
 */
export function nearestOnCubic(cubic: Cubic, point: Point): NearestOnCubic {
  const distanceSquaredAt = (t: number): number => {
    const q = evalCubic(cubic, t);
    return (q.x - point.x) ** 2 + (q.y - point.y) ** 2;
  };
  const samples = Array.from({ length: NEAREST_COARSE_SAMPLES + 1 }, (unused, index) =>
    distanceSquaredAt(index / NEAREST_COARSE_SAMPLES),
  );
  const at = (index: number): number => samples[index] ?? Number.POSITIVE_INFINITY;
  const candidates: number[] = [];
  for (let index = 0; index <= NEAREST_COARSE_SAMPLES; index += 1) {
    // An end counts when it is no further than its one neighbour.
    if (at(index) <= at(index - 1) && at(index) <= at(index + 1)) {
      candidates.push(index / NEAREST_COARSE_SAMPLES);
    }
  }
  let bestT = 0;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    let low = Math.max(0, candidate - 1 / NEAREST_COARSE_SAMPLES);
    let high = Math.min(1, candidate + 1 / NEAREST_COARSE_SAMPLES);
    for (let step = 0; step < NEAREST_REFINE_STEPS; step += 1) {
      const first = low + (high - low) / 3;
      const second = high - (high - low) / 3;
      if (distanceSquaredAt(first) < distanceSquaredAt(second)) high = second;
      else low = first;
    }
    const t = (low + high) / 2;
    const distanceSquared = distanceSquaredAt(t);
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestT = t;
    }
  }
  const nearest = evalCubic(cubic, bestT);
  return {
    t: bestT,
    point: nearest,
    distance: Math.hypot(nearest.x - point.x, nearest.y - point.y),
  };
}

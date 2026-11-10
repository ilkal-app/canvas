import {
  closedLoops,
  flattenChain,
  indexNetwork,
  loopCubics,
  nearestOnCubic,
  type PathNetwork,
} from '@canvas/engine';
import type { Point, Vertex } from '@canvas/schema';

import { handleAt, isZeroHandle, segmentsAt, vertexOf, type SegmentEnd } from './network.js';
import { isNearBounds, segmentBoundsOf } from './segment-bounds.js';

// Hit tests of the pen tool and vector edit, the prototype's `hit.ts`
// (webgl-whiteboard `src/vector/hit.ts`): points are in the path's own frame, tolerances in the
// same units (the CSS px constants below divided by the zoom). A press in vector edit looks for a
// handle first, then a vertex, then a segment; the pen's press, a vertex, then a segment.

/** How near a press must land to a handle's tip to take it, CSS px. */
export const HANDLE_HIT_TOLERANCE_PX = 6;

/** How near a press must land to a vertex to take it, CSS px. */
export const VERTEX_HIT_TOLERANCE_PX = 6;

/** How near a press must land to a segment's curve to take it, CSS px. */
export const SEGMENT_HIT_TOLERANCE_PX = 5;

/** A handle a press landed on: the segment end it belongs to. */
export interface HandleHit {
  /** The segment. */
  readonly segmentId: string;
  /** Which end. */
  readonly end: SegmentEnd;
  /** The vertex at that end. */
  readonly vertexId: string;
  /** Where that vertex is, local units: the handle is an offset from it. */
  readonly origin: Point;
}

/** A segment a press landed on, and where along it. */
export interface SegmentHit {
  /** The segment. */
  readonly segmentId: string;
  /** The curve parameter of the nearest point, in [0, 1]. */
  readonly t: number;
}

/**
 * The vertex nearest a point, within a tolerance.
 *
 * @param network - The network.
 * @param point - The point, local units.
 * @param tolerance - The largest distance, local units.
 * @returns The vertex, or `undefined`.
 */
export function nearestVertex(
  network: PathNetwork,
  point: Point,
  tolerance: number,
): Vertex | undefined {
  let best: Vertex | undefined;
  let bestDistance = tolerance;
  for (const vertex of network.vertices) {
    const distance = Math.hypot(vertex.x - point.x, vertex.y - point.y);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = vertex;
    }
  }
  return best;
}

/**
 * The id of the vertex nearest a point, within a tolerance.
 *
 * @param network - The network.
 * @param point - The point, local units.
 * @param tolerance - The largest distance, local units.
 * @returns The vertex's id, or `undefined`.
 */
export function hitVertex(
  network: PathNetwork,
  point: Point,
  tolerance: number,
): string | undefined {
  return nearestVertex(network, point, tolerance)?.id;
}

/**
 * The handle tip nearest a point, within a tolerance, among the handles of the given vertices
 * (the selected ones: only their handles show) that are pulled out.
 *
 * @param network - The network.
 * @param vertexIds - The vertices whose handles show.
 * @param point - The point, local units.
 * @param tolerance - The largest distance, local units.
 * @returns The handle, or `undefined`.
 */
export function hitNetworkHandle(
  network: PathNetwork,
  vertexIds: Iterable<string>,
  point: Point,
  tolerance: number,
): HandleHit | undefined {
  let best: HandleHit | undefined;
  let bestDistance = tolerance;
  for (const vertexId of vertexIds) {
    const vertex = vertexOf(network, vertexId);
    if (!vertex) continue;
    for (const { segment, end } of segmentsAt(network, vertexId)) {
      const handle = handleAt(segment, end);
      if (isZeroHandle(handle)) continue;
      const distance = Math.hypot(vertex.x + handle.x - point.x, vertex.y + handle.y - point.y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { segmentId: segment.id, end, vertexId, origin: { x: vertex.x, y: vertex.y } };
      }
    }
  }
  return best;
}

/**
 * The segment whose curve passes nearest a point, within a tolerance, and the parameter of its
 * nearest point.
 *
 * @param network - The network.
 * @param point - The point, local units.
 * @param tolerance - The largest distance, local units.
 * @returns The segment and parameter, or `undefined`.
 */
export function hitSegment(
  network: PathNetwork,
  point: Point,
  tolerance: number,
): SegmentHit | undefined {
  let best: SegmentHit | undefined;
  let bestDistance = tolerance;
  // Only a curve whose box is near the point is measured (`segment-bounds.ts`).
  for (const bounds of segmentBoundsOf(network)) {
    if (!isNearBounds(bounds, point.x, point.y, bestDistance)) continue;
    const nearest = nearestOnCubic(bounds.cubic, point);
    if (nearest.distance <= bestDistance) {
      bestDistance = nearest.distance;
      best = { segmentId: bounds.segment.id, t: nearest.t };
    }
  }
  return best;
}

/**
 * Whether a point is inside polygons by the even-odd rule: a hole is outside.
 *
 * @param polygons - The polygons, each closed implicitly.
 * @param point - The point.
 * @returns True inside.
 */
export function isInsideEvenOdd(polygons: readonly (readonly Point[])[], point: Point): boolean {
  let isInside = false;
  for (const polygon of polygons) {
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const first = polygon[index];
      const second = polygon[previous];
      if (!first || !second) continue;
      const isCrossing =
        first.y > point.y !== second.y > point.y &&
        point.x < ((second.x - first.x) * (point.y - first.y)) / (second.y - first.y) + first.x;
      if (isCrossing) isInside = !isInside;
    }
  }
  return isInside;
}

/**
 * Whether a point is inside a network's fill: the even-odd union of its closed loops (only
 * closed-loop components fill), flattened as the path pass flattens them.
 *
 * @param network - The network.
 * @param point - The point, local units.
 * @param tolerance - The flattening tolerance, local units.
 * @returns True inside.
 */
export function hitFill(network: PathNetwork, point: Point, tolerance: number): boolean {
  const index = indexNetwork(network);
  const polygons = closedLoops(index).map((loop) =>
    flattenChain(loopCubics(index, loop), tolerance),
  );
  return isInsideEvenOdd(polygons, point);
}

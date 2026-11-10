import type { Point } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';

import { containsPoint } from './bounds.js';

/**
 * The distance from a point to a line segment.
 *
 * @param point - The point.
 * @param start - The segment's start.
 * @param end - The segment's end; may equal `start`.
 * @returns The shortest distance, in the points' units.
 */
export function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/**
 * The distance from a point to the nearest piece of any polyline. A polyline of one point (a
 * line whose ends coincide, drawn as a dot) counts as that point, so it can still be picked.
 *
 * @param point - The point.
 * @param polylines - The polylines, each a run of connected points.
 * @returns The shortest distance, or infinity when there is no point at all.
 */
export function distanceToPolylines(
  point: Point,
  polylines: readonly (readonly Point[])[],
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const polyline of polylines) {
    const [only] = polyline;
    if (polyline.length === 1 && only) {
      nearest = Math.min(nearest, Math.hypot(point.x - only.x, point.y - only.y));
      continue;
    }
    let start: Point | undefined;
    for (const end of polyline) {
      if (start) nearest = Math.min(nearest, distanceToSegment(point, start, end));
      start = end;
    }
  }
  return nearest;
}

/**
 * Whether a point is inside the even-odd fill of a set of polylines, by counting crossings of a
 * ray towards +x (the fill rule of the path renderer). Each polyline's
 * pieces count as edges; a well-formed closed path's segments form its closed regions.
 *
 * @param polylines - The outlines.
 * @param point - The point.
 * @returns True when the ray crosses an odd number of edges.
 */
export function isInsideEvenOdd(polylines: readonly (readonly Point[])[], point: Point): boolean {
  let isInside = false;
  for (const polyline of polylines) {
    let a: Point | undefined;
    for (const b of polyline) {
      // Only an edge that straddles the ray's height can cross it (never a horizontal one).
      if (a && a.y > point.y !== b.y > point.y) {
        const crossingX = a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y);
        if (point.x < crossingX) isInside = !isInside;
      }
      a = b;
    }
  }
  return isInside;
}

/**
 * Whether a line segment meets a rectangle, edges included (Liang–Barsky clipping: the segment
 * meets it when the parameter interval left after clipping against all four edges is not empty).
 *
 * @param start - The segment's start.
 * @param end - The segment's end.
 * @param rect - The rectangle.
 * @returns True when some point of the segment is in the rectangle.
 */
export function segmentMeetsBounds(start: Point, end: Point, rect: WorldBounds): boolean {
  if (containsPoint(rect, start) || containsPoint(rect, end)) return true;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let enter = 0;
  let exit = 1;
  const edges: readonly [number, number][] = [
    [-dx, start.x - rect.minX],
    [dx, rect.maxX - start.x],
    [-dy, start.y - rect.minY],
    [dy, rect.maxY - start.y],
  ];
  for (const [direction, distance] of edges) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const t = distance / direction;
    if (direction < 0) {
      enter = Math.max(enter, t);
    } else {
      exit = Math.min(exit, t);
    }
  }
  return enter <= exit;
}

/**
 * Whether a convex polygon meets a rectangle, edges included, by the separating axis theorem:
 * they are apart exactly when their projections are apart on one of the rectangle's axes or one
 * of the polygon's edge normals.
 *
 * @param polygon - The convex polygon's corners, in order.
 * @param rect - The rectangle.
 * @returns True when they share a point.
 */
export function convexPolygonMeetsBounds(polygon: readonly Point[], rect: WorldBounds): boolean {
  const rectCorners = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
  const axes = [{ x: 1, y: 0 }, { x: 0, y: 1 }, ...edgeNormals(polygon)];
  return axes.every((axis) => {
    const [polygonMin, polygonMax] = projectOnto(polygon, axis);
    const [rectMin, rectMax] = projectOnto(rectCorners, axis);
    return polygonMin <= rectMax && rectMin <= polygonMax;
  });
}

function edgeNormals(polygon: readonly Point[]): Point[] {
  const normals: Point[] = [];
  let corner = polygon.at(-1);
  for (const next of polygon) {
    if (corner) normals.push({ x: corner.y - next.y, y: next.x - corner.x });
    corner = next;
  }
  return normals;
}

function projectOnto(points: readonly Point[], axis: Point): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const projection = point.x * axis.x + point.y * axis.y;
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }
  return [min, max];
}

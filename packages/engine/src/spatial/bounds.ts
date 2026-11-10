import type { Point } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';

/**
 * Whether two boxes overlap. Edges are inclusive, so boxes that only touch intersect.
 *
 * @param first - One box, world units.
 * @param second - Another box, world units.
 * @returns True when they share at least one point.
 */
export function intersectsBounds(first: WorldBounds, second: WorldBounds): boolean {
  return (
    first.minX <= second.maxX &&
    second.minX <= first.maxX &&
    first.minY <= second.maxY &&
    second.minY <= first.maxY
  );
}

/**
 * Whether one box lies entirely inside another, edges included.
 *
 * @param outer - The containing box.
 * @param inner - The contained box.
 * @returns True when every point of `inner` is in `outer`.
 */
export function containsBounds(outer: WorldBounds, inner: WorldBounds): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    inner.maxX <= outer.maxX &&
    inner.maxY <= outer.maxY
  );
}

/**
 * Whether a point lies in a box, edges included.
 *
 * @param bounds - The box, world units.
 * @param point - The point, world units.
 * @returns True when the point is inside or on an edge.
 */
export function containsPoint(bounds: WorldBounds, point: Point): boolean {
  return (
    bounds.minX <= point.x &&
    point.x <= bounds.maxX &&
    bounds.minY <= point.y &&
    point.y <= bounds.maxY
  );
}

/**
 * The smallest box containing two boxes.
 *
 * @param first - One box.
 * @param second - Another box.
 * @returns A new box.
 */
export function unionBounds(first: WorldBounds, second: WorldBounds): WorldBounds {
  return {
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY),
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY),
  };
}

/**
 * A box's area.
 *
 * @param bounds - The box.
 * @returns Width × height, square world units.
 */
export function boundsArea(bounds: WorldBounds): number {
  return (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
}

/**
 * The area of the union of two boxes, without allocating it: the R-tree's measure of how much a
 * node must grow to take an entry.
 *
 * @param first - One box.
 * @param second - Another box.
 * @returns The area of their union, square world units.
 */
export function enlargedArea(first: WorldBounds, second: WorldBounds): number {
  return (
    (Math.max(first.maxX, second.maxX) - Math.min(first.minX, second.minX)) *
    (Math.max(first.maxY, second.maxY) - Math.min(first.minY, second.minY))
  );
}

/**
 * Whether two boxes have the same edges.
 *
 * @param first - One box.
 * @param second - Another box.
 * @returns True when all four edges are equal.
 */
export function isSameBounds(first: WorldBounds, second: WorldBounds): boolean {
  return (
    first.minX === second.minX &&
    first.minY === second.minY &&
    first.maxX === second.maxX &&
    first.maxY === second.maxY
  );
}

/**
 * A box grown by the same margin on every side.
 *
 * @param bounds - The box.
 * @param margin - How far to move each edge outwards, world units.
 * @returns A new box.
 */
export function expandBounds(bounds: WorldBounds, margin: number): WorldBounds {
  return {
    minX: bounds.minX - margin,
    minY: bounds.minY - margin,
    maxX: bounds.maxX + margin,
    maxY: bounds.maxY + margin,
  };
}

/**
 * The zero-size box at a point, for point queries.
 *
 * @param point - The point, world units.
 * @returns The box whose four edges pass through the point.
 */
export function pointBounds(point: Point): WorldBounds {
  return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
}

/**
 * The smallest box containing every point.
 *
 * @param points - The points.
 * @returns Their bounds, or `undefined` for no points.
 */
export function boundsAround(points: readonly Point[]): WorldBounds | undefined {
  if (points.length === 0) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Whether two optional boxes are the same: both absent, or equal.
 *
 * @param first - A box, or undefined.
 * @param second - Another, or undefined.
 * @returns True when they match.
 */
export function isSameBox(
  first: WorldBounds | undefined,
  second: WorldBounds | undefined,
): boolean {
  return first === undefined || second === undefined
    ? first === second
    : isSameBounds(first, second);
}

/**
 * Whether a box's four edges are finite numbers.
 *
 * @param box - The box.
 * @returns True when they are.
 */
export function isFiniteBounds(box: WorldBounds): boolean {
  return (
    Number.isFinite(box.minX) &&
    Number.isFinite(box.minY) &&
    Number.isFinite(box.maxX) &&
    Number.isFinite(box.maxY)
  );
}

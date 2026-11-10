import type { Point } from '../fields/point.js';

/**
 * A linear map followed by a translation, `p ↦ (a·p.x + c·p.y + x, b·p.x + d·p.y + y)`: how a
 * group resize moves the points of a frame. Objects
 * themselves are rigid; only their stored geometry (box sizes, line points, path
 * vertices) takes the scale.
 */
export interface AffineMap {
  /** How the x axis maps: its x component. */
  readonly a: number;
  /** How the x axis maps: its y component. */
  readonly b: number;
  /** How the y axis maps: its x component. */
  readonly c: number;
  /** How the y axis maps: its y component. */
  readonly d: number;
  /** Horizontal translation, world units. */
  readonly x: number;
  /** Vertical translation, world units. */
  readonly y: number;
}

/**
 * Maps a point through the whole map.
 *
 * @param map - The map.
 * @param point - The point.
 * @returns A new point.
 */
export function mapPoint(map: AffineMap, point: Point): Point {
  return {
    x: map.a * point.x + map.c * point.y + map.x,
    y: map.b * point.x + map.d * point.y + map.y,
  };
}

/**
 * Maps a vector through the linear part only (a displacement, a curve handle's offset).
 *
 * @param map - The map.
 * @param vector - The vector.
 * @returns A new vector.
 */
export function mapVector(map: AffineMap, vector: Point): Point {
  return { x: map.a * vector.x + map.c * vector.y, y: map.b * vector.x + map.d * vector.y };
}

/**
 * The same map seen from inside an object turned by `rotation` and placed at `origin` before
 * the map, whose new origin is `movedOrigin`: a point in the object's own frame is placed in
 * the parent's frame, mapped, and brought back into the object's frame as it is after the map
 * (turned the same, at `movedOrigin`). The linear part becomes `R⁻¹·L·R`.
 *
 * @param map - The map, in the parent's frame.
 * @param rotation - The object's rotation, radians; kept by the map.
 * @param origin - The object's origin before, in the parent's frame.
 * @param movedOrigin - The object's origin after, in the parent's frame.
 * @returns The map in the object's own frame.
 */
export function mapInsideObject(
  map: AffineMap,
  rotation: number,
  origin: Point,
  movedOrigin: Point,
): AffineMap {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // R⁻¹·v for the columns of L·R and for the translation.
  const unturn = (vector: Point): Point => ({
    x: cos * vector.x + sin * vector.y,
    y: -sin * vector.x + cos * vector.y,
  });
  const xAxis = unturn(mapVector(map, { x: cos, y: sin }));
  const yAxis = unturn(mapVector(map, { x: -sin, y: cos }));
  const mapped = mapPoint(map, origin);
  const shift = unturn({ x: mapped.x - movedOrigin.x, y: mapped.y - movedOrigin.y });
  return { a: xAxis.x, b: xAxis.y, c: yAxis.x, d: yAxis.y, x: shift.x, y: shift.y };
}

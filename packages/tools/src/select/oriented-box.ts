import type { WorldBounds } from '@canvas/engine';
import type { Point } from '@canvas/schema';

/**
 * A rectangle turned about its top-left corner, in world units: the frame the select tool
 * draws and drags handles on. One object's frame is its own box turned
 * with it; a multi-selection's frame is the axis-aligned box around every selected object. The
 * box spans local (0, 0) to (`width`, `height`), and a local point maps to the world as the
 * schema's frames do (`@canvas/schema` `placementTransform`): turn by `rotation`, then move to
 * (`x`, `y`).
 */
export interface OrientedBox {
  /** World x of the box's top-left corner, world units. */
  readonly x: number;
  /** World y of the box's top-left corner, world units. */
  readonly y: number;
  /** Width along the box's own x axis, world units, at least 0. */
  readonly width: number;
  /** Height along the box's own y axis, world units, at least 0. */
  readonly height: number;
  /** Turn about the top-left corner, radians, clockwise on screen (y points down). */
  readonly rotation: number;
}

/**
 * Turns a point about a pivot, clockwise on screen.
 *
 * @param point - The point, world units.
 * @param pivot - The fixed point, world units.
 * @param angle - The angle, radians.
 * @returns The turned point.
 */
export function rotatePointAbout(point: Point, pivot: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return { x: pivot.x + cos * dx - sin * dy, y: pivot.y + sin * dx + cos * dy };
}

/**
 * Brings an angle into (−π, π], the range `rotateObjects` stores rotations in.
 *
 * @param angle - The angle, radians.
 * @returns The same turn, radians, in (−π, π].
 */
export function normalizeAngle(angle: number): number {
  const turn = 2 * Math.PI;
  const wrapped = angle - turn * Math.floor((angle + Math.PI) / turn);
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/**
 * Maps a point of a box's own frame to the world.
 *
 * @param box - The box.
 * @param local - The point, world units along the box's axes from its top-left corner.
 * @returns The point in world units.
 */
export function boxPointToWorld(box: OrientedBox, local: Point): Point {
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  return { x: box.x + cos * local.x - sin * local.y, y: box.y + sin * local.x + cos * local.y };
}

/**
 * Maps a world point into a box's own frame: the inverse of {@link boxPointToWorld}.
 *
 * @param box - The box.
 * @param world - The point, world units.
 * @returns The point along the box's axes from its top-left corner.
 */
export function worldPointToBox(box: OrientedBox, world: Point): Point {
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  const dx = world.x - box.x;
  const dy = world.y - box.y;
  return { x: cos * dx + sin * dy, y: -sin * dx + cos * dy };
}

/**
 * The corners of a box in the world, clockwise from its top-left.
 *
 * @param box - The box.
 * @returns Top-left, top-right, bottom-right, bottom-left, world units.
 */
export function boxCornersOf(box: OrientedBox): [Point, Point, Point, Point] {
  return [
    boxPointToWorld(box, { x: 0, y: 0 }),
    boxPointToWorld(box, { x: box.width, y: 0 }),
    boxPointToWorld(box, { x: box.width, y: box.height }),
    boxPointToWorld(box, { x: 0, y: box.height }),
  ];
}

/**
 * The centre of a box, the pivot a rotation drag turns it about.
 *
 * @param box - The box.
 * @returns The centre, world units.
 */
export function boxCentreOf(box: OrientedBox): Point {
  return boxPointToWorld(box, { x: box.width / 2, y: box.height / 2 });
}

/**
 * Whether a world point lies inside a box, edges included.
 *
 * @param box - The box.
 * @param point - The point, world units.
 * @returns True when inside.
 */
export function isInsideBox(box: OrientedBox, point: Point): boolean {
  const local = worldPointToBox(box, point);
  // A small tolerance absorbs the rounding of the turn back into the box's frame.
  const epsilon = 1e-9 * Math.max(1, box.width, box.height);
  return (
    local.x >= -epsilon &&
    local.y >= -epsilon &&
    local.x <= box.width + epsilon &&
    local.y <= box.height + epsilon
  );
}

/**
 * The smallest axis-aligned box holding every point: a multi-selection's frame.
 *
 * @param points - The points, world units.
 * @returns The box with rotation 0, or undefined for no points.
 */
export function boxAround(points: Iterable<Point>): OrientedBox | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (minX > maxX) return undefined;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, rotation: 0 };
}

/**
 * The world rectangle holding a box, turned or not: the bounds of its four corners. The one
 * box-to-bounds conversion of the select tool and snapping.
 *
 * @param box - The box.
 * @returns Its axis-aligned bounds, world units.
 */
export function worldBoundsOfBox(box: OrientedBox): WorldBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { x, y } of boxCornersOf(box)) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Turns a box rigidly about a pivot: its corner goes round the pivot and its rotation grows.
 *
 * @param box - The box; not changed.
 * @param pivot - The fixed point, world units.
 * @param angle - The angle, radians, clockwise on screen.
 * @returns The turned box.
 */
export function rotateBoxAbout(box: OrientedBox, pivot: Point, angle: number): OrientedBox {
  const corner = rotatePointAbout(box, pivot, angle);
  return { ...box, x: corner.x, y: corner.y, rotation: box.rotation + angle };
}

/**
 * Moves a box by a displacement.
 *
 * @param box - The box; not changed.
 * @param delta - The displacement, world units.
 * @returns The moved box.
 */
export function translateBox(box: OrientedBox, delta: Point): OrientedBox {
  return { ...box, x: box.x + delta.x, y: box.y + delta.y };
}

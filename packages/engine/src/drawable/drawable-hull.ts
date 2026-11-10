import { freehandPointsOf, type BoardObject } from '@canvas/schema';

import { isPlacedWithin, type Placement } from './drawable-placement.js';

/**
 * An axis-aligned box in a frame or group's own frame holding every point of its descendants'
 * geometry (their hull points, as the extent check measures them). While no descendant changes,
 * the box moves rigidly with the frame, so whether the whole subtree stays within the extent
 * after the frame moved or turned is answered by the box's four corners (fix round 2).
 */
export interface SubtreeHull {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * An empty hull, which any point extends.
 *
 * @returns The hull.
 */
export function emptyHull(): SubtreeHull {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

/**
 * Extends a hull by one point on the board, brought into the hull's frame.
 *
 * @param hull - The hull, in its frame's own frame.
 * @param frame - Its frame's placement on the board.
 * @param x - The point's world x.
 * @param y - The point's world y.
 */
function extendByWorldPoint(hull: SubtreeHull, frame: Placement, x: number, y: number): void {
  const dx = x - frame.x;
  const dy = y - frame.y;
  const localX = frame.cos * dx + frame.sin * dy;
  const localY = -frame.sin * dx + frame.cos * dy;
  hull.minX = Math.min(hull.minX, localX);
  hull.minY = Math.min(hull.minY, localY);
  hull.maxX = Math.max(hull.maxX, localX);
  hull.maxY = Math.max(hull.maxY, localY);
}

/**
 * Extends a hull by one point of an object's own frame.
 *
 * @param hull - The hull.
 * @param frame - The hull's frame's placement on the board.
 * @param placement - The object's placement on the board.
 * @param x - The point's x in the object's frame.
 * @param y - The point's y in the object's frame.
 */
function extendByPoint(
  hull: SubtreeHull,
  frame: Placement,
  placement: Placement,
  x: number,
  y: number,
): void {
  const worldX = placement.cos * x - placement.sin * y + placement.x;
  const worldY = placement.sin * x + placement.cos * y + placement.y;
  extendByWorldPoint(hull, frame, worldX, worldY);
}

/**
 * Extends a hull by an object's hull points, the points the extent check measures: a boxed
 * object's corners, a line's ends, a path's vertices and handle points, and the origin of a
 * group, connector or comment.
 *
 * @param hull - The hull, in `frame`'s own frame.
 * @param frame - The hull's frame's placement on the board.
 * @param object - A drawable object below that frame.
 * @param placement - The object's placement on the board.
 */
export function extendHull(
  hull: SubtreeHull,
  frame: Placement,
  object: BoardObject,
  placement: Placement,
): void {
  switch (object.type) {
    case 'line':
      for (const point of object.points) extendByPoint(hull, frame, placement, point.x, point.y);
      return;
    case 'path': {
      const byId = new Map(object.vertices.map((vertex) => [vertex.id, vertex]));
      for (const vertex of object.vertices) {
        extendByPoint(hull, frame, placement, vertex.x, vertex.y);
      }
      for (const { a, b, ha, hb } of object.segments) {
        const start = byId.get(a);
        const end = byId.get(b);
        if (start) extendByPoint(hull, frame, placement, start.x + ha.x, start.y + ha.y);
        if (end) extendByPoint(hull, frame, placement, end.x + hb.x, end.y + hb.y);
      }
      return;
    }
    case 'freehand': {
      // Its stored points, as the extent check measures them (`drawable-geometry.ts`).
      for (const { x, y } of freehandPointsOf(object.points)) {
        extendByPoint(hull, frame, placement, x, y);
      }
      return;
    }
    case 'group':
    case 'connector':
    case 'comment':
      extendByPoint(hull, frame, placement, 0, 0);
      return;
    default:
      extendByPoint(hull, frame, placement, 0, 0);
      extendByPoint(hull, frame, placement, object.width, 0);
      extendByPoint(hull, frame, placement, object.width, object.height);
      extendByPoint(hull, frame, placement, 0, object.height);
  }
}

/**
 * Whether a subtree's hull, carried by its frame to a new placement, lies within the extent:
 * its four corners do, so every point inside does (the extent is convex).
 *
 * @param hull - The hull, in the frame's own frame.
 * @param frame - The frame's placement on the board now.
 * @returns True when the whole subtree stays within the extent.
 */
export function isHullWithin(hull: SubtreeHull, frame: Placement): boolean {
  if (hull.minX > hull.maxX) return true;
  return (
    isPlacedWithin(frame, hull.minX, hull.minY) &&
    isPlacedWithin(frame, hull.maxX, hull.minY) &&
    isPlacedWithin(frame, hull.maxX, hull.maxY) &&
    isPlacedWithin(frame, hull.minX, hull.maxY)
  );
}

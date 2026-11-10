import type { Board } from '../board/board.js';
import type { ChildIndex } from '../board/child-index.js';
import type { Point } from '../fields/point.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';
import type { PathObject } from '../objects/path-object.js';

import { freehandLocalBounds } from './freehand-curve.js';
import { applyTransform, placementTransform } from './rigid-transform.js';

/** An axis-aligned rectangle in some frame, world units. */
export interface Rect {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width, at least 0. */
  readonly width: number;
  /** Height, at least 0. */
  readonly height: number;
}

/** The empty rectangle at the origin, used for objects with no extent of their own. */
const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * The smallest rectangle containing every point, or the empty rectangle at the origin. One pass
 * with running extremes: spreading the coordinates into `Math.min` would exceed the call stack
 * for a group of tens of thousands of children (4 corners each) or a long path.
 *
 * @param points - The points to contain.
 * @returns Their axis-aligned bounding rectangle.
 */
function rectAround(points: readonly Point[]): Rect {
  if (points.length === 0) return EMPTY_RECT;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The four corners of a rectangle, clockwise from the top-left.
 *
 * @param rect - The rectangle.
 * @returns Its corners.
 */
function cornersOf(rect: Rect): Point[] {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return [
    { x: rect.x, y: rect.y },
    { x: right, y: rect.y },
    { x: right, y: bottom },
    { x: rect.x, y: bottom },
  ];
}

/**
 * The bounds of a group: its children's bounds placed in the group's frame, unioned. Connectors
 * and comments are skipped, since their geometry follows other objects; an empty group has the
 * empty rectangle.
 *
 * @param board - The board holding the group's descendants.
 * @param group - The group.
 * @param children - The board's child index.
 * @param visiting - Groups on the current path, to stop at a parent cycle.
 * @returns The group's bounds in its own frame.
 */
function groupBounds(
  board: Board,
  group: BoardObject,
  children: ChildIndex,
  visiting: Set<ObjectId>,
): Rect {
  if (visiting.has(group.id)) return EMPTY_RECT;
  visiting.add(group.id);
  const corners: Point[] = [];
  for (const childId of children.get(group.id) ?? []) {
    const child = board.objects.get(childId);
    if (child === undefined || child.type === 'connector' || child.type === 'comment') continue;
    const childToGroup = placementTransform(child.x, child.y, child.rotation);
    for (const corner of cornersOf(boundsIn(board, child, children, visiting))) {
      corners.push(applyTransform(childToGroup, corner));
    }
  }
  visiting.delete(group.id);
  return rectAround(corners);
}

/**
 * Dispatches on the object type; see {@link localBounds}.
 *
 * @param board - The board holding the object.
 * @param object - The object.
 * @param children - The board's child index.
 * @param visiting - Groups on the current path.
 * @returns The object's bounds in its own frame.
 */
function boundsIn(
  board: Board,
  object: BoardObject,
  children: ChildIndex,
  visiting: Set<ObjectId>,
): Rect {
  switch (object.type) {
    case 'line':
      return rectAround(object.points);
    case 'path':
      return pathBounds(object);
    case 'freehand':
      return freehandLocalBounds(object);
    case 'group':
      return groupBounds(board, object, children, visiting);
    case 'connector':
    case 'comment':
      return EMPTY_RECT;
    default:
      return { x: 0, y: 0, width: object.width, height: object.height };
  }
}

/**
 * Bounds already measured on one unchanged board, keyed by object id. Callers that measure many
 * targets on the same board (every connector attached to a deleted group) share one cache, so a
 * large group's subtree is walked once rather than once per connector. A cache must not outlive
 * the board it was filled from.
 */
export type BoundsCache = Map<ObjectId, Rect>;

/**
 * The bounds of a path's network in its own frame: its vertices and its segments' handle points,
 * which contain its curves (a cubic lies in the hull of its control points). Pure.
 *
 * @param path - The path.
 * @returns The bounds, world units.
 */
export function pathBounds(path: Pick<PathObject, 'vertices' | 'segments'>): Rect {
  const vertices = new Map(path.vertices.map((vertex) => [vertex.id, vertex]));
  const handlePoints = path.segments.flatMap((segment) => {
    const start = vertices.get(segment.a);
    const end = vertices.get(segment.b);
    if (start === undefined || end === undefined) return [];
    return [
      { x: start.x + segment.ha.x, y: start.y + segment.ha.y },
      { x: end.x + segment.hb.x, y: end.y + segment.hb.y },
    ];
  });
  return rectAround([...path.vertices, ...handlePoints]);
}

/**
 * The axis-aligned bounds of an object in its own frame. Boxed types (text, sticky, image,
 * video, shape, frame) span their stored box; a line spans its points; a path spans its
 * vertices and handle control points, which contain its curves; a group is derived from its
 * children, skipping connectors and comments; a connector or comment
 * has the empty rectangle at its origin.
 *
 * @param board - The board holding the object and, for a group, its descendants.
 * @param object - The object.
 * @param children - The board's child index, from `buildChildIndex`.
 * @param cache - Bounds already measured on this same board; the result is added to it.
 * @returns The bounds, in world units in the object's own frame.
 */
export function localBounds(
  board: Board,
  object: BoardObject,
  children: ChildIndex,
  cache: BoundsCache = new Map(),
): Rect {
  const cached = cache.get(object.id);
  if (cached !== undefined) return cached;
  const bounds = boundsIn(board, object, children, new Set());
  cache.set(object.id, bounds);
  return bounds;
}

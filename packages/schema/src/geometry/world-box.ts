import { BOARD_BOUND } from '../fields/board-bound.js';
import type { Point } from '../fields/point.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';

import { freehandPointsOf } from './freehand-samples.js';
import {
  applyTransform,
  composeTransforms,
  placementTransform,
  type RigidTransform,
} from './rigid-transform.js';

/**
 * An axis-aligned box in some frame, by its four extents, world units. Its numbers may be
 * non-finite when the geometry it was worked out from is ({@link isFiniteBox}).
 */
export interface ExtentBox {
  /** The smallest x. */
  readonly minX: number;
  /** The largest x. */
  readonly maxX: number;
  /** The smallest y. */
  readonly minY: number;
  /** The largest y. */
  readonly maxY: number;
}

/** The names of an {@link ExtentBox}'s four extents. */
export const EXTENT_NAMES = ['minX', 'maxX', 'minY', 'maxY'] as const;

/** One of an {@link ExtentBox}'s four extents. */
export type ExtentName = (typeof EXTENT_NAMES)[number];

/**
 * The points of an object's geometry in its own frame, whose box is the object's box: a boxed
 * object's four corners, a line's points, a path's vertices and the control points its handles
 * reach (vertex plus handle), a freehand stroke's stored points (as a line's, its stroke's reach not counted), a connector's free ends, a comment pinned to a point its own origin.
 * A group has none of its own (its members are judged each), and neither has a comment pinned to
 * an object, whose pin offset is a value with a limit of its own, not a position.
 *
 * @param object - The object.
 * @returns The points; empty when the object has no geometry of its own.
 */
export function geometryPointsOf(object: BoardObject): Point[] {
  switch (object.type) {
    case 'line':
      return [...object.points];
    case 'path': {
      const vertices = new Map(object.vertices.map((vertex) => [vertex.id, vertex]));
      const controls = object.segments.flatMap((segment): Point[] => {
        const start = vertices.get(segment.a);
        const end = vertices.get(segment.b);
        if (start === undefined || end === undefined) return [];
        return [
          { x: start.x + segment.ha.x, y: start.y + segment.ha.y },
          { x: end.x + segment.hb.x, y: end.y + segment.hb.y },
        ];
      });
      return [...object.vertices, ...controls];
    }
    case 'freehand':
      return freehandPointsOf(object.points);
    case 'connector':
      return [object.from, object.to].flatMap((end): Point[] =>
        end.kind === 'point' ? [{ x: end.x, y: end.y }] : [],
      );
    case 'group':
      return [];
    case 'comment':
      return object.anchor.kind === 'point' ? [{ x: 0, y: 0 }] : [];
    default:
      return [
        { x: 0, y: 0 },
        { x: object.width, y: 0 },
        { x: object.width, y: object.height },
        { x: 0, y: object.height },
      ];
  }
}

/**
 * The box of points placed by a transform: each point mapped, then the smallest box round them.
 * A non-finite coordinate is kept (as NaN when it makes a comparison fail), so the caller can
 * tell the box cannot be computed ({@link isFiniteBox}).
 *
 * @param points - The points, in the transform's inner frame.
 * @param transform - The transform to the frame the box is in.
 * @returns The box, or `undefined` when there are no points.
 */
export function boxOfPoints(
  points: readonly Point[],
  transform: RigidTransform,
): ExtentBox | undefined {
  if (points.length === 0) return undefined;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let isAllFinite = true;
  for (const point of points) {
    const { x, y } = applyTransform(transform, point);
    if (!(Number.isFinite(x) && Number.isFinite(y))) isAllFinite = false;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return isAllFinite ? { minX, maxX, minY, maxY } : { minX: NaN, maxX: NaN, minY: NaN, maxY: NaN };
}

/**
 * The box of an object's geometry ({@link geometryPointsOf}) in the frame a transform maps its
 * own frame into; a boxed object without building its point list.
 *
 * @param object - The object.
 * @param transform - The transform from the object's own frame.
 * @returns The box, or `undefined` for an object with no geometry of its own.
 */
export function geometryBoxOf(
  object: BoardObject,
  transform: RigidTransform,
): ExtentBox | undefined {
  if (!('width' in object)) return boxOfPoints(geometryPointsOf(object), transform);
  const { cos, sin, x, y } = transform;
  const [ax, bx] = [cos * object.width, -sin * object.height];
  const [ay, by] = [sin * object.width, cos * object.height];
  const box = {
    minX: x + Math.min(0, ax) + Math.min(0, bx),
    maxX: x + Math.max(0, ax) + Math.max(0, bx),
    minY: y + Math.min(0, ay) + Math.min(0, by),
    maxY: y + Math.max(0, ay) + Math.max(0, by),
  };
  return isFiniteBox(box) ? box : { minX: NaN, maxX: NaN, minY: NaN, maxY: NaN };
}

/**
 * Tells whether every extent of a box is a finite number.
 *
 * @param box - The box.
 * @returns `true` when it is.
 */
export function isFiniteBox(box: ExtentBox): boolean {
  return (
    Number.isFinite(box.minX) &&
    Number.isFinite(box.maxX) &&
    Number.isFinite(box.minY) &&
    Number.isFinite(box.maxY)
  );
}

/**
 * Tells whether a box lies within the board's bound: every extent finite and within
 * ±`BOARD_BOUND`.
 *
 * @param box - The box, in the board's frame.
 * @returns `true` when it does.
 */
export function isBoxWithinBound(box: ExtentBox): boolean {
  return EXTENT_NAMES.every((name) => Math.abs(box[name]) <= BOARD_BOUND);
}

/**
 * The transform from an object's own frame to the board's, through its chain of parents: a
 * parent the lookup does not find ends the chain (a paste's list ends at its target, a board's
 * dangling parent at the root, as the engine draws it). Composed from the top of the chain down,
 * as a walk from a parent to its children composes it, so both give the same numbers: far from
 * the origin the order of a floating-point composition decides whether it overflows. A parent
 * cycle, or a transform that is not finite (a stored number that is not, or a composition that
 * overflows), cannot be placed.
 *
 * @param object - The object.
 * @param lookup - Finds an object by id.
 * @returns The transform, or `undefined` when the object cannot be placed on the board.
 */
export function boardTransformOf(
  object: BoardObject,
  lookup: (id: ObjectId) => BoardObject | undefined,
): RigidTransform | undefined {
  const chain: BoardObject[] = [object];
  const seen = new Set<ObjectId>([object.id]);
  for (let parentId = object.parentId; parentId !== null;) {
    if (seen.has(parentId)) return undefined;
    const parent = lookup(parentId);
    if (parent === undefined) break;
    seen.add(parentId);
    chain.push(parent);
    parentId = parent.parentId;
  }
  let transform: RigidTransform | undefined;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const next = chain[index];
    if (next === undefined) continue;
    const placement = placementTransform(next.x, next.y, next.rotation);
    transform = transform === undefined ? placement : composeTransforms(transform, placement);
  }
  return transform !== undefined && isFiniteTransform(transform) ? transform : undefined;
}

/**
 * Tells whether a transform's four numbers are finite.
 *
 * @param transform - The transform.
 * @returns `true` when they are.
 */
export function isFiniteTransform(transform: RigidTransform): boolean {
  return (
    Number.isFinite(transform.cos) &&
    Number.isFinite(transform.sin) &&
    Number.isFinite(transform.x) &&
    Number.isFinite(transform.y)
  );
}

import { buildChildIndex } from '../board/child-index.js';
import type { Point } from '../fields/point.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';
import type { ConnectorEnd } from '../objects/connector-object.js';

import { mapInsideObject, mapPoint, mapVector, type AffineMap } from './affine-map.js';
import { freehandPointsOf } from './freehand-samples.js';
import { localBounds } from './local-bounds.js';

/**
 * What a group resize reads: objects by id and each object's children. `DocumentStore` gives
 * both (`get`, `references.childrenOf`), and so does the select tool's `SelectionSource`, so the
 * tool's drag preview and the command compute the same geometry.
 */
export interface ObjectTreeReader {
  /**
   * An object by id.
   *
   * @param id - The id.
   * @returns The object, or `undefined`.
   */
  get(id: ObjectId): BoardObject | undefined;
  /**
   * The ids of an object's children.
   *
   * @param id - The parent's id.
   * @returns The children's ids, in no particular order.
   */
  childrenOf(id: ObjectId): Iterable<ObjectId>;
}

/** A size, world units. */
export interface BoxSize {
  /** Width, world units. */
  readonly width: number;
  /** Height, world units. */
  readonly height: number;
}

/**
 * A group resize, in the terms of `resizeObjects`: the derived box's new size (`to`) or its
 * change of size (`by`), and where the box's top-left corner goes.
 */
export type GroupResize = (
  | {
      /** The derived box's new size, world units. */
      readonly to: BoxSize;
    }
  | {
      /** The change of the derived box's size, world units. */
      readonly by: BoxSize;
    }
) & {
  /**
   * Where the derived box's top-left corner goes, world units in the group's parent frame;
   * omitted, it stays where it is.
   */
  readonly corner?: Point;
};

/** A group resize planned: the box's new size and the objects it rewrites. */
export interface GroupResizePlan {
  /** The derived box's size before the resize, world units. */
  readonly before: BoxSize;
  /** The derived box's new size, world units; negative when `by` shrinks it past zero. */
  readonly size: BoxSize;
  /** The group and every descendant after the resize, the group first. */
  readonly objects: readonly BoardObject[];
}

/**
 * Gathers a group and everything under it, stopping at a parent cycle.
 *
 * @param tree - The document.
 * @param group - The group.
 * @returns The objects by id.
 */
function subtreeOf(tree: ObjectTreeReader, group: BoardObject): Map<ObjectId, BoardObject> {
  const objects = new Map<ObjectId, BoardObject>([[group.id, group]]);
  const pending = [...tree.childrenOf(group.id)];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const object = objects.has(next) ? undefined : tree.get(next);
    if (object === undefined) continue;
    objects.set(next, object);
    pending.push(...tree.childrenOf(next));
  }
  return objects;
}

/**
 * A free connector end moved by a map in the connector's own frame; an attached end follows its
 * target and is kept.
 *
 * @param end - The end.
 * @param map - The map in the connector's frame.
 * @returns The end.
 */
function mapEnd(end: ConnectorEnd, map: AffineMap): ConnectorEnd {
  return end.kind === 'point' ? { ...end, ...mapPoint(map, end) } : end;
}

/**
 * One object after a map of its parent's frame, rigid as every object is: its rotation
 * is kept, a boxed object's centre follows the map and its sides stretch by the length the map
 * gives its own axes (the select tool's multi-selection rule: exact when the object is turned
 * with the group or a quarter turn from it), while a line's points, a path's vertices and
 * handles and a free connector end are mapped exactly in the object's own frame, as are the
 * children of a group or frame.
 *
 * @param object - The object.
 * @param map - The map, in its parent's frame.
 * @param children - Each object's children, within the resized subtree.
 * @param objects - The resized subtree by id.
 * @param into - Where to add the mapped objects, the object's first; an object already there
 *   (met again on a parent cycle) is not mapped twice.
 */
export function mapObject(
  object: BoardObject,
  map: AffineMap,
  children: ReadonlyMap<ObjectId | null, readonly ObjectId[]>,
  objects: ReadonlyMap<ObjectId, BoardObject>,
  into: Map<ObjectId, BoardObject>,
): void {
  if (into.has(object.id)) return;
  const cos = Math.cos(object.rotation);
  const sin = Math.sin(object.rotation);
  const turn = (point: Point): Point => ({
    x: cos * point.x - sin * point.y,
    y: sin * point.x + cos * point.y,
  });
  let moved: BoardObject;
  if ('width' in object) {
    const half = turn({ x: object.width / 2, y: object.height / 2 });
    const centre = mapPoint(map, { x: object.x + half.x, y: object.y + half.y });
    const xAxis = mapVector(map, { x: cos, y: sin });
    const yAxis = mapVector(map, { x: -sin, y: cos });
    const width = object.width * Math.hypot(xAxis.x, xAxis.y);
    const height = object.height * Math.hypot(yAxis.x, yAxis.y);
    const movedHalf = turn({ x: width / 2, y: height / 2 });
    moved = { ...object, x: centre.x - movedHalf.x, y: centre.y - movedHalf.y, width, height };
  } else {
    moved = { ...object, ...mapPoint(map, object) };
  }
  const inside = mapInsideObject(map, object.rotation, object, moved);
  switch (moved.type) {
    case 'line':
      moved = {
        ...moved,
        points: [mapPoint(inside, moved.points[0]), mapPoint(inside, moved.points[1])],
      };
      break;
    case 'freehand': {
      const points = freehandPointsOf(moved.points).flatMap((point) => {
        const mapped = mapPoint(inside, point);
        return [mapped.x, mapped.y];
      });
      moved = { ...moved, points };
      break;
    }
    case 'path':
      moved = {
        ...moved,
        vertices: moved.vertices.map((vertex) => ({ ...vertex, ...mapPoint(inside, vertex) })),
        segments: moved.segments.map((segment) => ({
          ...segment,
          ha: mapVector(inside, segment.ha),
          hb: mapVector(inside, segment.hb),
        })),
      };
      break;
    case 'connector':
      moved = { ...moved, from: mapEnd(moved.from, inside), to: mapEnd(moved.to, inside) };
      break;
    default:
      break;
  }
  into.set(moved.id, moved);
  for (const childId of children.get(object.id) ?? []) {
    const child = objects.get(childId);
    if (child !== undefined) mapObject(child, inside, children, objects, into);
  }
}

/**
 * A group resized: its derived box (`localBounds`)
 * scaled along the group's own axes about the box's top-left corner to the new size, and
 * that corner moved to `corner` in the parent's frame when given. Nothing is stored on the
 * group but its position (a group has no size); every descendant is rewritten in its own
 * parent's frame (`mapObject`): boxed objects stretch and move, line points and path vertices
 * scale, font sizes and stroke widths do not change, rotations are kept. A side of zero length
 * cannot scale and stays as it is. Pure: the objects read are not changed.
 *
 * @param tree - The document before the resize.
 * @param group - The group.
 * @param resize - The new size, or change of size, and the corner.
 * @returns The new size and the rewritten objects.
 */
export function planGroupResize(
  tree: ObjectTreeReader,
  group: BoardObject,
  resize: GroupResize,
): GroupResizePlan {
  const objects = subtreeOf(tree, group);
  const board = { objects };
  const children = buildChildIndex(board);
  const bounds = localBounds(board, group, children);
  const size =
    'to' in resize
      ? resize.to
      : { width: bounds.width + resize.by.width, height: bounds.height + resize.by.height };
  const scaleX = bounds.width > 0 ? size.width / bounds.width : 1;
  const scaleY = bounds.height > 0 ? size.height / bounds.height : 1;
  const cos = Math.cos(group.rotation);
  const sin = Math.sin(group.rotation);
  const offset = { x: cos * bounds.x - sin * bounds.y, y: sin * bounds.x + cos * bounds.y };
  const position =
    resize.corner === undefined
      ? { x: group.x, y: group.y }
      : { x: resize.corner.x - offset.x, y: resize.corner.y - offset.y };
  const resized = new Map<ObjectId, BoardObject>([[group.id, { ...group, ...position }]]);
  const scale: AffineMap = {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    x: bounds.x * (1 - scaleX),
    y: bounds.y * (1 - scaleY),
  };
  for (const childId of children.get(group.id) ?? []) {
    const child = objects.get(childId);
    if (child !== undefined) mapObject(child, scale, children, objects, resized);
  }
  const before = { width: bounds.width, height: bounds.height };
  return { before, size, objects: [...resized.values()] };
}

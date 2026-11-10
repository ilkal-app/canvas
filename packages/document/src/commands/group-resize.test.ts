import { describe, expect, it } from 'vitest';

import {
  applyTransform,
  buildChildIndex,
  localBounds,
  objectToBoardTransform,
  type Board,
  type BoardObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';

import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { createGroupedStore } from './__fixtures__/grouped-board.js';
import { planGroupResize, type ObjectTreeReader } from './group-resize.js';

/**
 * The store as the resize reads it.
 *
 * @param store - The store.
 * @returns The reader.
 */
function treeOf(store: YjsDocumentStore): ObjectTreeReader {
  return { get: (id) => store.get(id), childrenOf: (id) => store.references.childrenOf(id) };
}

/**
 * An object by id, which must exist.
 *
 * @param board - The board.
 * @param objectId - The id.
 * @returns The object.
 * @throws {Error} When the board has no such object.
 */
function objectOf(board: Board, objectId: string): BoardObject {
  const object = board.objects.get(objectId as ObjectId);
  if (object === undefined) throw new Error(`no object "${objectId}"`);
  return object;
}

/**
 * The points that define an object's geometry, in its own frame: a box's corners, a line's
 * points, a path's vertices and the ends of its handles.
 *
 * @param object - The object.
 * @returns The points.
 */
function definingPoints(object: BoardObject): Point[] {
  switch (object.type) {
    case 'line':
      return [...object.points];
    case 'path': {
      const at = new Map(object.vertices.map((vertex) => [vertex.id, vertex]));
      const handles = object.segments.flatMap((segment) => {
        const [a, b] = [at.get(segment.a), at.get(segment.b)];
        return a && b
          ? [
              { x: a.x + segment.ha.x, y: a.y + segment.ha.y },
              { x: b.x + segment.hb.x, y: b.y + segment.hb.y },
            ]
          : [];
      });
      return [...object.vertices, ...handles];
    }
    default:
      return 'width' in object
        ? [
            { x: 0, y: 0 },
            { x: object.width, y: 0 },
            { x: object.width, y: object.height },
            { x: 0, y: object.height },
          ]
        : [{ x: 0, y: 0 }];
  }
}

/**
 * An object's defining points on the board.
 *
 * @param board - The board.
 * @param objectId - The object.
 * @returns The points, board coordinates.
 */
function boardPoints(board: Board, objectId: string): Point[] {
  const object = objectOf(board, objectId);
  const toBoard = objectToBoardTransform(board, object);
  return definingPoints(object).map((point) => applyTransform(toBoard, point));
}

/**
 * A board with the planned objects laid over it.
 *
 * @param board - The board before.
 * @param objects - The planned objects.
 * @returns The board after.
 */
function withPlan(board: Board, objects: readonly BoardObject[]): Board {
  const merged = new Map(board.objects);
  for (const object of objects) merged.set(object.id, object);
  return { objects: merged };
}

/**
 * Where a board point goes when a group at the root, turned by `rotation` and placed at
 * `before`, is scaled about its local origin and moved to `after`.
 *
 * @param point - The point before, board coordinates.
 * @param group - The group's placement before and after, and its scale.
 * @param group.before - Its origin before.
 * @param group.after - Its origin after.
 * @param group.rotation - Its rotation.
 * @param group.scale - The scale along its own axes.
 * @returns The point after.
 */
function expectedPoint(
  point: Point,
  group: { before: Point; after: Point; rotation: number; scale: Point },
): Point {
  const [cos, sin] = [Math.cos(group.rotation), Math.sin(group.rotation)];
  const dx = point.x - group.before.x;
  const dy = point.y - group.before.y;
  const local = { x: cos * dx + sin * dy, y: -sin * dx + cos * dy };
  const scaled = { x: local.x * group.scale.x, y: local.y * group.scale.y };
  return {
    x: group.after.x + cos * scaled.x - sin * scaled.y,
    y: group.after.y + sin * scaled.x + cos * scaled.y,
  };
}

const BEFORE = { x: 100, y: 50 };
const ROTATION = 0.4;

describe('planGroupResize', () => {
  const store = createGroupedStore();
  const board = store.read();
  const group = objectOf(board, 'group-outer');
  const bounds = localBounds(board, group, buildChildIndex(board));
  const corner = { x: 130, y: 20 };
  const scale = { x: 2, y: 0.5 };
  const plan = planGroupResize(treeOf(store), group, {
    to: { width: bounds.width * scale.x, height: bounds.height * scale.y },
    corner,
  });
  const after = withPlan(board, plan.objects);
  const move = { before: BEFORE, after: corner, rotation: ROTATION, scale };

  it('keeps the fixture group’s derived box at its local origin', () => {
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
  });

  it('scales a turned group’s children along its axes, exact in board space', () => {
    for (const id of ['rect-a', 'rect-b', 'line-l', 'path-p', 'line-m']) {
      const expected = boardPoints(board, id).map((point) => expectedPoint(point, move));
      boardPoints(after, id).forEach((point, index) => {
        expect(point.x).toBeCloseTo(expected[index]?.x ?? Number.NaN, 9);
        expect(point.y).toBeCloseTo(expected[index]?.y ?? Number.NaN, 9);
      });
    }
  });

  it('moves a nested turned box’s centre exactly and stretches it along its own axes', () => {
    const centre = (target: Board): Point => {
      const [first, , third] = boardPoints(target, 'rect-c');
      return {
        x: ((first?.x ?? 0) + (third?.x ?? 0)) / 2,
        y: ((first?.y ?? 0) + (third?.y ?? 0)) / 2,
      };
    };
    const expected = expectedPoint(centre(board), move);
    expect(centre(after).x).toBeCloseTo(expected.x, 9);
    expect(centre(after).y).toBeCloseTo(expected.y, 9);
    const rect = objectOf(after, 'rect-c');
    // rect-c is turned 0.3 rad from the outer group's axes.
    const [cos, sin] = [Math.cos(0.3), Math.sin(0.3)];
    expect(rect).toMatchObject({ rotation: 0 });
    expect('width' in rect && rect.width).toBeCloseTo(40 * Math.hypot(2 * cos, 0.5 * sin), 9);
    expect('height' in rect && rect.height).toBeCloseTo(30 * Math.hypot(2 * sin, 0.5 * cos), 9);
  });

  it('keeps rotations, stroke widths and the group’s own fields', () => {
    for (const object of plan.objects) {
      expect(object.rotation).toBe(objectOf(board, object.id).rotation);
    }
    expect(objectOf(after, 'line-l')).toMatchObject({ stroke: { width: 2 } });
    expect(objectOf(after, 'group-outer')).toEqual({ ...group, ...plan.objects[0] });
    expect(plan.objects[0]?.id).toBe('group-outer');
    expect(plan.objects.map(({ id }) => id).sort()).toEqual(
      [
        'group-outer',
        'group-inner',
        'line-l',
        'line-m',
        'path-p',
        'rect-a',
        'rect-b',
        'rect-c',
      ].sort(),
    );
  });

  it('gives the derived box the size asked for when its children turn with the group', () => {
    // A turned box whose sides are not along the group's axes cannot stretch exactly (objects
    // are rigid), so the nested group, whose children are unturned in it, is the exact case.
    const inner = objectOf(board, 'group-inner');
    const innerBounds = localBounds(board, inner, buildChildIndex(board));
    const innerPlan = planGroupResize(treeOf(store), inner, {
      to: { width: innerBounds.width * 3, height: innerBounds.height / 4 },
    });
    const resizedBoard = withPlan(board, innerPlan.objects);
    const resized = localBounds(
      resizedBoard,
      objectOf(resizedBoard, 'group-inner'),
      buildChildIndex(resizedBoard),
    );
    expect(resized.x).toBeCloseTo(innerBounds.x, 9);
    expect(resized.y).toBeCloseTo(innerBounds.y, 9);
    expect(resized.width).toBeCloseTo(innerBounds.width * 3, 9);
    expect(resized.height).toBeCloseTo(innerBounds.height / 4, 9);
    expect(plan.size).toEqual({ width: bounds.width * 2, height: bounds.height * 0.5 });
  });

  it('keeps the box’s corner in place when no corner is given, and takes a change of size', () => {
    const byPlan = planGroupResize(treeOf(store), group, { by: { width: 10, height: -20 } });
    expect(byPlan.size).toEqual({ width: bounds.width + 10, height: bounds.height - 20 });
    expect(byPlan.objects[0]).toMatchObject({ x: 100, y: 50 });
  });

  it('leaves the objects it read unchanged', () => {
    expect(store.read().objects).toEqual(board.objects);
  });
});

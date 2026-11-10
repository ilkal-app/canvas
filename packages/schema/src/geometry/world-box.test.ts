import { describe, expect, it } from 'vitest';

import { BOARD_BOUND } from '../fields/board-bound.js';
import type { ObjectId } from '../ids/object-id.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import type { BoardObject } from '../objects/board-object.js';

import { IDENTITY_TRANSFORM, placementTransform } from './rigid-transform.js';
import {
  boardTransformOf,
  boxOfPoints,
  geometryBoxOf,
  geometryPointsOf,
  isBoxWithinBound,
  isFiniteBox,
} from './world-box.js';

const B = BOARD_BOUND;

/**
 * The box of an object on a board of the given objects.
 *
 * @param objects - The board.
 * @param id - The object.
 * @returns Its box on the board, or `undefined`.
 * @throws {Error} When the board has no such object.
 */
function boxOn(objects: readonly BoardObject[], id: string) {
  const byId = new Map(objects.map((object) => [object.id as string, object]));
  const object = byId.get(id);
  if (object === undefined) throw new Error(`no ${id}`);
  const transform = boardTransformOf(object, (key) => byId.get(key));
  return transform && geometryBoxOf(object, transform);
}

describe('geometryBoxOf: an object’s box in a frame', () => {
  it('is a boxed object’s corners, turned: a quarter turn about the origin', () => {
    const shape = sampleObject('shape', 's', { x: 10, y: 20, width: 100, height: 50 });
    expect(geometryBoxOf(shape, placementTransform(10, 20, 0))).toEqual({
      minX: 10,
      maxX: 110,
      minY: 20,
      maxY: 70,
    });
    const turned = geometryBoxOf(shape, placementTransform(0, 0, Math.PI / 2));
    expect(turned?.minX).toBeCloseTo(-50, 9);
    expect(turned?.maxX).toBeCloseTo(0, 9);
    expect(turned?.maxY).toBeCloseTo(100, 9);
  });

  it('agrees with the box of its corner points', () => {
    const shape = sampleObject('shape', 's', { width: 37, height: 11 });
    for (const angle of [0, 0.3, 1.9, -2.7, Math.PI]) {
      const transform = placementTransform(5, -7, angle);
      const byCorners = boxOfPoints(geometryPointsOf(shape), transform);
      const box = geometryBoxOf(shape, transform);
      for (const name of ['minX', 'maxX', 'minY', 'maxY'] as const) {
        expect(box?.[name]).toBeCloseTo(byCorners?.[name] ?? NaN, 9);
      }
    }
  });

  it('is a line’s points, a path’s vertices and handle control points, a connector’s free ends', () => {
    const line = sampleObject('line', 'l', {
      points: [
        { x: -5, y: 3 },
        { x: 40, y: -9 },
      ],
    });
    expect(geometryBoxOf(line, IDENTITY_TRANSFORM)).toEqual({
      minX: -5,
      maxX: 40,
      minY: -9,
      maxY: 3,
    });
    const path = sampleObject('path', 'p', {
      vertices: [
        { id: 'a', x: 0, y: 0, mirror: 'none' },
        { id: 'b', x: 10, y: 0, mirror: 'none' },
      ],
      segments: [{ id: 'ab', a: 'a', b: 'b', ha: { x: 0, y: -30 }, hb: { x: 5, y: 0 } }],
    });
    expect(geometryBoxOf(path, IDENTITY_TRANSFORM)).toEqual({
      minX: 0,
      maxX: 15,
      minY: -30,
      maxY: 0,
    });
    const connector = sampleObject('connector', 'k', {
      from: { kind: 'point', x: 1, y: 2 },
      to: { kind: 'object', objectId: 's' as ObjectId, anchor: null },
    });
    expect(geometryBoxOf(connector, IDENTITY_TRANSFORM)).toEqual({
      minX: 1,
      maxX: 1,
      minY: 2,
      maxY: 2,
    });
  });

  it('has none for a group or a comment pinned to an object; a comment on a point is its origin', () => {
    expect(geometryBoxOf(sampleObject('group', 'g'), IDENTITY_TRANSFORM)).toBeUndefined();
    const pinned = sampleObject('comment', 'c', {
      anchor: { kind: 'object', objectId: 's' as ObjectId, offset: { x: 1e300, y: 0 } },
    });
    expect(geometryBoxOf(pinned, IDENTITY_TRANSFORM)).toBeUndefined();
    const free = sampleObject('comment', 'c', { x: 3, y: 4, anchor: { kind: 'point' } });
    expect(geometryBoxOf(free, placementTransform(3, 4, 0))).toEqual({
      minX: 3,
      maxX: 3,
      minY: 4,
      maxY: 4,
    });
  });

  it('is marked not finite when the arithmetic overflows', () => {
    const shape = sampleObject('shape', 's', { width: 1e308, height: 1 });
    const box = geometryBoxOf(shape, placementTransform(1e308, 0, 0));
    expect(box && isFiniteBox(box)).toBe(false);
    expect(box && isBoxWithinBound(box)).toBe(false);
  });
});

describe('boardTransformOf: through the chain of parents', () => {
  it('places a member of a group of two frames at -B and +B inside the bound', () => {
    const objects = [
      sampleObject('group', 'g', { x: -B, y: 0 }),
      sampleObject('frame', 'right', {
        parentId: 'g' as ObjectId,
        x: 2 * B,
        y: 0,
        width: 0,
        height: 0,
      }),
    ];
    const box = boxOn(objects, 'right');
    expect(box).toEqual({ minX: B, maxX: B, minY: 0, maxY: 0 });
    expect(box && isBoxWithinBound(box)).toBe(true);
  });

  it('turns a member with its group', () => {
    const objects = [
      sampleObject('group', 'g', { x: 100, y: 0, rotation: Math.PI / 2 }),
      sampleObject('shape', 's', { parentId: 'g' as ObjectId, x: 10, y: 0, width: 5, height: 5 }),
    ];
    const box = boxOn(objects, 's');
    expect(box?.minX).toBeCloseTo(95, 9);
    expect(box?.minY).toBeCloseTo(10, 9);
  });

  it('ends at a parent it does not find, and cannot place a cycle or a transform that overflows', () => {
    const orphan = sampleObject('shape', 'o', { parentId: 'gone' as ObjectId, x: 7, y: 0 });
    expect(boardTransformOf(orphan, () => undefined)).toMatchObject({ x: 7 });
    const first = sampleObject('group', 'a', { parentId: 'b' as ObjectId });
    const second = sampleObject('group', 'b', { parentId: 'a' as ObjectId });
    const byId = new Map<string, BoardObject>([
      ['a', first],
      ['b', second],
    ]);
    expect(boardTransformOf(first, (key) => byId.get(key))).toBeUndefined();
    const far = sampleObject('group', 'f', { x: 1e308 });
    const child = sampleObject('group', 'c', { parentId: 'f' as ObjectId, x: 1e308 });
    expect(boardTransformOf(child, () => far)).toBeUndefined();
    const nan = sampleObject('shape', 'n', { x: Number.NaN });
    expect(boardTransformOf(nan, () => undefined)).toBeUndefined();
  });
});

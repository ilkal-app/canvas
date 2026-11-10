import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { frameObject, shapeObject, sourceOf } from './__fixtures__/scene-objects.js';
import { worldTransformOf } from './world-transform.js';

function expectTransform(
  actual: { cos: number; sin: number; x: number; y: number },
  expected: { cos: number; sin: number; x: number; y: number },
): void {
  expect(actual.cos).toBeCloseTo(expected.cos, 12);
  expect(actual.sin).toBeCloseTo(expected.sin, 12);
  expect(actual.x).toBeCloseTo(expected.x, 12);
  expect(actual.y).toBeCloseTo(expected.y, 12);
}

describe('worldTransformOf', () => {
  it('is the placement of a root object', () => {
    const shape = shapeObject('s', { x: 5, y: 7, rotation: Math.PI / 2 });
    expectTransform(worldTransformOf(shape, sourceOf([shape])), { cos: 0, sin: 1, x: 5, y: 7 });
  });

  it('translates by the parent, then rotates about its origin, for a child', () => {
    const frame = frameObject('f', { x: 100, y: 50, rotation: Math.PI / 2 });
    const child = shapeObject('s', { parentId: 'f', x: 10, y: 0 });
    // The child's origin (10, 0) in the frame's frame, turned 90° clockwise: (0, 10) from the
    // frame's origin.
    expectTransform(worldTransformOf(child, sourceOf([frame, child])), {
      cos: 0,
      sin: 1,
      x: 100,
      y: 60,
    });
  });

  it('treats an object whose parent is missing as a root object', () => {
    const child = shapeObject('s', { parentId: 'gone', x: 3, y: 4 });
    expectTransform(worldTransformOf(child, sourceOf([child])), { cos: 1, sin: 0, x: 3, y: 4 });
  });

  it('stops at a parent cycle instead of looping', () => {
    const first = frameObject('a', { parentId: 'b', x: 1, y: 0 });
    const second = frameObject('b', { parentId: 'a', x: 2, y: 0 });
    const objects = new Map<ObjectId, BoardObject>([
      [first.id, first],
      [second.id, second],
    ]);
    const transform = worldTransformOf(first, { get: (id) => objects.get(id) });
    expect(transform.x).toBe(3);
  });
});

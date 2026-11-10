// The layout section's measures and plans: where an object is, and which existing
// command a committed X, Y, W, H or rotation runs. Pure.
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { memoryShape } from './__fixtures__/memory-board.js';
import { layoutBoxOf, planLayoutChange, roundForField } from './layout-box.js';

function shape(id: string, fields: Record<string, unknown> = {}): BoardObject {
  return { ...memoryShape(id, 'a0'), ...fields };
}

function boardOf(objects: readonly BoardObject[]) {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return {
    get: (id: ObjectId) => byId.get(id),
    references: {
      childrenOf: (id: ObjectId) =>
        objects.filter((object) => object.parentId === id).map((object) => object.id),
    },
  };
}

const A = shape('a', { x: 412, y: 268, width: 176, height: 120 });
// A line stores no box: the fixture's width and height are left out.
const UNBOXED = Object.fromEntries(
  Object.entries(shape('l')).filter(([key]) => key !== 'width' && key !== 'height'),
);
const LINE = {
  ...UNBOXED,
  type: 'line',
  x: 10,
  y: 20,
  points: [
    { x: 0, y: 0 },
    { x: 30, y: 40 },
  ],
} as unknown as BoardObject;

describe('layoutBoxOf', () => {
  it('measures a boxed object by its box on the board and its stored size', () => {
    expect(layoutBoxOf(boardOf([A]), A)).toEqual({
      x: 412,
      y: 268,
      width: 176,
      height: 120,
      rotation: 0,
      canResize: true,
    });
  });

  it('resizes a main and an instance by their own box (an instance’s size is its override)', () => {
    for (const type of ['component', 'instance']) {
      const boxed = { ...A, type } as unknown as BoardObject;
      expect(layoutBoxOf(boardOf([boxed]), boxed)).toMatchObject({ canResize: true });
    }
  });

  it('measures a line by its points, its size shown but not resizable', () => {
    expect(layoutBoxOf(boardOf([LINE]), LINE)).toMatchObject({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      canResize: false,
    });
  });

  it('measures a group by everything under it', () => {
    const group = shape('g', { type: 'group', x: 0, y: 0 });
    const left = shape('c1', { parentId: 'g', x: 10, y: 10, width: 20, height: 20 });
    const right = shape('c2', { parentId: 'g', x: 100, y: 50, width: 20, height: 20 });
    expect(layoutBoxOf(boardOf([group, left, right]), group)).toMatchObject({
      x: 10,
      y: 10,
      width: 110,
      height: 60,
      canResize: true,
    });
  });

  it('shows a rotation in degrees, rounded to two places', () => {
    expect(layoutBoxOf(boardOf([A]), { ...A, rotation: Math.PI / 6 })?.rotation).toBe(30);
    expect(roundForField(-0.001)).toBe(0);
    expect(roundForField(1.23456)).toBe(1.23);
  });
});

describe('planLayoutChange', () => {
  const board = boardOf([A, LINE]);

  it('moves by what puts each box’s left or top at the value', () => {
    expect(planLayoutChange(board, [A, LINE], 'x', 100)).toEqual({
      kind: 'move',
      input: {
        moves: [
          { id: 'a', by: { x: -312, y: 0 } },
          { id: 'l', by: { x: 90, y: 0 } },
        ],
      },
    });
  });

  it('resizes only what resizeObjects takes, keeping the other side', () => {
    expect(planLayoutChange(board, [A, LINE], 'height', 50)).toEqual({
      kind: 'resize',
      input: { resizes: [{ id: 'a', to: { width: 176, height: 50 } }] },
    });
    expect(planLayoutChange(board, [LINE], 'width', 50)).toBeUndefined();
  });

  it('turns each object about its box’s centre to the angle', () => {
    expect(planLayoutChange(board, [A], 'rotation', 90)).toEqual({
      kind: 'rotate',
      input: { rotations: [{ id: 'a', by: Math.PI / 2, about: { x: 500, y: 328 } }] },
    });
  });

  it('plans nothing for a value already there', () => {
    expect(planLayoutChange(board, [A], 'y', 268)).toBeUndefined();
    expect(planLayoutChange(board, [A], 'rotation', 0)).toBeUndefined();
  });
});

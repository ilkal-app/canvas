import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import { id, indexOf, mapSource, selectBoardObjects } from '../select/__fixtures__/select-board.js';
import type { SelectPointer } from '../select/select-input.js';

import { lineEndAt, type LineEndContext } from './line-end.js';

const OBJECTS = selectBoardObjects();
const CONTEXT: LineEndContext = {
  index: indexOf(OBJECTS),
  source: mapSource(OBJECTS),
  excludedIds: new Set(),
  zoom: 1,
  snapping: { isEnabled: true, isGridVisible: false },
  viewport: { minX: -1000, minY: -1000, maxX: 2000, maxY: 2000 },
};

/**
 * A pointer at a world point.
 *
 * @param world - The point.
 * @param modifiers - Shift and the snap modifier.
 * @returns The pointer.
 */
function pointer(world: Point, modifiers: Partial<SelectPointer> = {}): SelectPointer {
  return { screen: world, world, isShiftPressed: false, isModPressed: false, ...modifiers };
}

describe('lineEndAt', () => {
  it('lands on an anchor within reach', () => {
    expect(lineEndAt(pointer({ x: 103, y: 27 }), undefined, CONTEXT)).toEqual({
      point: { x: 100, y: 25 },
      anchor: { x: 100, y: 25 },
      guides: [],
    });
  });

  it('snaps to an edge line when no anchor is near, with a guide', () => {
    const end = lineEndAt(pointer({ x: 30, y: 53 }), undefined, CONTEXT);
    expect(end.point).toEqual({ x: 30, y: 50 });
    expect(end.anchor).toBeUndefined();
    expect(end.guides.length).toBeGreaterThan(0);
  });

  it('snaps to the grid while it shows', () => {
    const grid = { ...CONTEXT, snapping: { isEnabled: true, isGridVisible: true } };
    const end = lineEndAt(pointer({ x: -301, y: -299 }), undefined, grid);
    // At zoom 1 the grid is 16 or 32 world units apart: -304 or -288 on x, -304 or -288 on y.
    expect(Math.abs(end.point.x % 16)).toBe(0);
    expect(Math.abs(end.point.y % 16)).toBe(0);
  });

  it('does not snap with the snap modifier held, nor with snapping off', () => {
    const at = { x: 103, y: 27 };
    expect(lineEndAt(pointer(at, { isSnapSuspended: true }), undefined, CONTEXT).point).toEqual(at);
    const off = { ...CONTEXT, snapping: { isEnabled: false, isGridVisible: false } };
    expect(lineEndAt(pointer(at), undefined, off).point).toEqual(at);
  });

  it('constrains to 45° about the fixed end with Shift, and then snaps nothing', () => {
    const end = lineEndAt(
      pointer({ x: 103, y: 27 }, { isShiftPressed: true }),
      { x: 0, y: 25 },
      CONTEXT,
    );
    expect(end.point.y).toBeCloseTo(25, 9);
    expect(end.point.x).toBeCloseTo(Math.hypot(103, 2), 9);
    expect(end.anchor).toBeUndefined();
  });

  it('leaves out the line being edited', () => {
    const excluded: LineEndContext = { ...CONTEXT, excludedIds: new Set([id('rect-a')]) };
    expect(lineEndAt(pointer({ x: 103, y: 27 }), undefined, excluded).anchor).toBeUndefined();
  });
});

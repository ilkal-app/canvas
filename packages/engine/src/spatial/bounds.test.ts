import { describe, expect, it } from 'vitest';

import {
  boundsAround,
  boundsArea,
  containsBounds,
  containsPoint,
  enlargedArea,
  expandBounds,
  intersectsBounds,
  isSameBounds,
  pointBounds,
  unionBounds,
} from './bounds.js';

const BOX = { minX: 0, minY: 0, maxX: 10, maxY: 5 };

describe('bounds', () => {
  it('counts touching edges as intersecting, since world bounds are edge-inclusive', () => {
    expect(intersectsBounds(BOX, { minX: 10, minY: 5, maxX: 12, maxY: 7 })).toBe(true);
    expect(intersectsBounds(BOX, { minX: 10.01, minY: 0, maxX: 12, maxY: 5 })).toBe(false);
    expect(intersectsBounds(BOX, { minX: 0, minY: -3, maxX: 1, maxY: -0.01 })).toBe(false);
  });

  it('contains a box inside it and itself, but not a box that crosses its edge', () => {
    expect(containsBounds(BOX, { minX: 1, minY: 1, maxX: 9, maxY: 4 })).toBe(true);
    expect(containsBounds(BOX, BOX)).toBe(true);
    expect(containsBounds(BOX, { minX: 1, minY: 1, maxX: 11, maxY: 4 })).toBe(false);
  });

  it('contains points on its edges and not points outside', () => {
    expect(containsPoint(BOX, { x: 10, y: 5 })).toBe(true);
    expect(containsPoint(BOX, { x: 10.5, y: 2 })).toBe(false);
  });

  it('unions, measures and compares boxes', () => {
    const other = { minX: -2, minY: 3, maxX: 4, maxY: 9 };
    expect(unionBounds(BOX, other)).toEqual({ minX: -2, minY: 0, maxX: 10, maxY: 9 });
    expect(boundsArea(BOX)).toBe(50);
    expect(enlargedArea(BOX, other)).toBe(12 * 9);
    expect(isSameBounds(BOX, { ...BOX })).toBe(true);
    expect(isSameBounds(BOX, { ...BOX, maxY: 6 })).toBe(false);
  });

  it('grows a box by a margin on every side and makes a point a zero-size box', () => {
    expect(expandBounds(BOX, 2)).toEqual({ minX: -2, minY: -2, maxX: 12, maxY: 7 });
    expect(pointBounds({ x: 3, y: 4 })).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
  });

  it('bounds a set of points, and has no bounds for no points', () => {
    const points = [
      { x: 3, y: -1 },
      { x: -2, y: 4 },
      { x: 1, y: 1 },
    ];
    expect(boundsAround(points)).toEqual({ minX: -2, minY: -1, maxX: 3, maxY: 4 });
    expect(boundsAround([])).toBeUndefined();
  });
});

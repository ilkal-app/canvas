import { describe, expect, it } from 'vitest';

import type { ObjectId, Point } from '@canvas/schema';

import type { ClipRect } from './clip-chain.js';
import { clippedFillBoundary, clippedFillMeetsBounds } from './clipped-fill.js';

/**
 * A square clip box.
 *
 * @param x - World x of its local origin.
 * @param y - World y of its local origin.
 * @param size - Its side.
 * @param angle - Its turn about its origin, radians.
 * @returns The clip rectangle.
 */
function clip(x: number, y: number, size: number, angle = 0): ClipRect {
  return {
    id: 'frame' as ObjectId,
    x,
    y,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
    width: size,
    height: size,
  };
}

/**
 * A closed square loop, its first corner repeated last.
 *
 * @param min - Its top-left corner's x and y.
 * @param max - Its bottom-right corner's x and y.
 * @returns The loop.
 */
function loop(min: number, max: number): Point[] {
  return [
    { x: min, y: min },
    { x: max, y: min },
    { x: max, y: max },
    { x: min, y: max },
    { x: min, y: min },
  ];
}

const bounds = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe('clippedFillBoundary', () => {
  it('is the clip region’s outline when the fill covers it', () => {
    const boundary = clippedFillBoundary([loop(-100, 200)], [clip(0, 0, 100)]);
    expect(boundary).toHaveLength(4);
    const ends = boundary.flatMap(([start, end]) => [start, end]);
    expect(Math.min(...ends.map(({ x }) => x))).toBe(0);
    expect(Math.max(...ends.map(({ y }) => y))).toBe(100);
  });

  it('is empty when nothing of the fill shows, and when there is no fill', () => {
    expect(clippedFillBoundary([loop(-200, 300), loop(-100, 200)], [clip(0, 0, 100)])).toEqual([]);
    expect(clippedFillBoundary([loop(200, 300)], [clip(0, 0, 100)])).toEqual([]);
    expect(clippedFillBoundary([], [clip(0, 0, 100)])).toEqual([]);
  });

  it('keeps a fill edge that runs along the clip’s edge', () => {
    // The fill's left edge lies on the clip's: parallel, so no crossing splits it.
    const boundary = clippedFillBoundary([loop(0, 50)], [clip(0, 0, 100)]);
    expect(boundary.length).toBeGreaterThanOrEqual(4);
    for (const [start, end] of boundary) {
      for (const { x, y } of [start, end]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(50);
        expect(y).toBeLessThanOrEqual(50);
      }
    }
  });

  it('cuts by a turned and a nested clip exactly', () => {
    // Turned 45° about (50, 0): a diamond reaching y ≈ 70.7 at most, all inside the fill.
    const turned = clippedFillBoundary([loop(-200, 300)], [clip(50, 0, 50, Math.PI / 4)]);
    const ys = turned.flatMap(([start, end]) => [start.y, end.y]);
    expect(Math.max(...ys)).toBeCloseTo(50 * Math.SQRT2);
    // Two nested boxes leave [50, 100]².
    const nested = clippedFillBoundary([loop(-200, 300)], [clip(50, 50, 100), clip(0, 0, 100)]);
    const xs = nested.flatMap(([start, end]) => [start.x, end.x]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([50, 100]);
  });
});

describe('clippedFillMeetsBounds', () => {
  const chain = [clip(0, 0, 100)];

  it('meets a marquee inside the visible fill, or touching it at the clip’s edge', () => {
    const fill = [loop(-100, 200)];
    expect(clippedFillMeetsBounds(fill, chain, bounds(40, 40, 60, 60))).toBe(true);
    expect(clippedFillMeetsBounds(fill, chain, bounds(90, 40, 130, 60))).toBe(true);
    expect(clippedFillMeetsBounds(fill, chain, bounds(110, 40, 130, 60))).toBe(false);
  });

  it('meets a marquee a fill edge crosses inside the clip', () => {
    expect(clippedFillMeetsBounds([loop(50, 200)], chain, bounds(40, 40, 60, 60))).toBe(true);
  });

  it('misses a marquee over a hole, or with no fill', () => {
    const ring = [loop(-200, 300), loop(-100, 200)];
    expect(clippedFillMeetsBounds(ring, chain, bounds(-10, -10, 110, 110))).toBe(false);
    expect(clippedFillMeetsBounds([], chain, bounds(0, 0, 100, 100))).toBe(false);
  });
});

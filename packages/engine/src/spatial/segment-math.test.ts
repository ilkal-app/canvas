import { describe, expect, it } from 'vitest';

import {
  convexPolygonMeetsBounds,
  distanceToPolylines,
  distanceToSegment,
  isInsideEvenOdd,
  segmentMeetsBounds,
} from './segment-math.js';

const RECT = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

describe('segment math', () => {
  it('measures the distance to a segment from beside it, past its ends, and to a point', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });

  it('measures the distance to the nearest of several polylines, infinite for none', () => {
    const polylines = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      ],
    ];
    expect(distanceToPolylines({ x: 5, y: 4 }, polylines)).toBe(1);
    expect(distanceToPolylines({ x: 5, y: 4 }, [])).toBe(Number.POSITIVE_INFINITY);
  });

  it('fills by the even-odd rule, so a hole inside a ring is outside', () => {
    const square = (size: number, offset: number) => [
      { x: offset, y: offset },
      { x: offset + size, y: offset },
      { x: offset + size, y: offset + size },
      { x: offset, y: offset + size },
      { x: offset, y: offset },
    ];
    const ring = [square(10, 0), square(4, 3)];
    expect(isInsideEvenOdd(ring, { x: 1, y: 1 })).toBe(true);
    expect(isInsideEvenOdd(ring, { x: 5, y: 5 })).toBe(false);
    expect(isInsideEvenOdd(ring, { x: 20, y: 5 })).toBe(false);
  });

  it('finds segments that cross a rectangle with both ends outside it', () => {
    expect(segmentMeetsBounds({ x: -5, y: 5 }, { x: 15, y: 5 }, RECT)).toBe(true);
    expect(segmentMeetsBounds({ x: -5, y: -4 }, { x: 4, y: -5 }, RECT)).toBe(false);
    expect(segmentMeetsBounds({ x: -5, y: 30 }, { x: 30, y: -5 }, RECT)).toBe(false);
    expect(segmentMeetsBounds({ x: -5, y: 8 }, { x: 8, y: -5 }, RECT)).toBe(true);
    expect(segmentMeetsBounds({ x: 12, y: -5 }, { x: 12, y: 15 }, RECT)).toBe(false);
    expect(segmentMeetsBounds({ x: 5, y: 5 }, { x: 50, y: 50 }, RECT)).toBe(true);
  });

  it('separates a convex polygon from a rectangle on an edge normal', () => {
    const diamond = [
      { x: 20, y: 10 },
      { x: 30, y: 20 },
      { x: 20, y: 30 },
      { x: 10, y: 20 },
    ];
    // The diamond's bounds (10..30) overlap the rectangle's corner, the diamond does not.
    expect(convexPolygonMeetsBounds(diamond, { minX: 0, minY: 0, maxX: 14, maxY: 14 })).toBe(false);
    expect(convexPolygonMeetsBounds(diamond, { minX: 0, minY: 0, maxX: 16, maxY: 16 })).toBe(true);
    expect(convexPolygonMeetsBounds([], RECT)).toBe(false);
  });
});

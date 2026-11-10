// The shader's polygon distance, which walks only the edges that can be within a band of the
// point (fix round 1), against the exact walk of every edge: equal wherever the exact
// distance is under the band, the same sign everywhere, at least the band elsewhere.
import { describe, expect, it } from 'vitest';

import { bandedPolygonDistance, polygonDistance } from './shape-distance.js';

/** Shapes from gentle to extreme stretch, few to many sides. */
const CASES = [
  { name: 'a stretched triangle', halfSize: { x: 150, y: 30 }, sides: 3, isStar: false },
  { name: 'a pentagon', halfSize: { x: 60, y: 60 }, sides: 5, isStar: false },
  { name: 'a 64-gon', halfSize: { x: 200, y: 90 }, sides: 64, isStar: false },
  { name: 'a thin 64-gon', halfSize: { x: 20, y: 200 }, sides: 64, isStar: false },
  {
    name: 'a three-point star, stretched thin',
    halfSize: { x: 500, y: 20 },
    sides: 3,
    isStar: true,
  },
  { name: 'a five-point star', halfSize: { x: 60, y: 45 }, sides: 5, isStar: true },
  { name: 'a thin 32-point star', halfSize: { x: 100, y: 8 }, sides: 32, isStar: true },
  { name: 'a screen-filling 64-point star', halfSize: { x: 700, y: 450 }, sides: 64, isStar: true },
] as const;

/** A thin outline plus a pixel, and the widest outline (the schema's 64) plus a pixel. */
const BANDS = [3, 65] as const;

describe('bandedPolygonDistance', () => {
  it.each(CASES)('is the exact distance within the band of $name', (shape) => {
    const { halfSize, sides, isStar } = shape;
    for (const band of BANDS) {
      let compared = 0;
      for (let row = 0; row <= 60; row += 1) {
        for (let column = 0; column <= 60; column += 1) {
          const point = {
            x: (column / 30 - 1) * halfSize.x * 1.3,
            y: (row / 30 - 1) * halfSize.y * 1.3,
          };
          const exact = polygonDistance(point, halfSize, sides, isStar);
          const banded = bandedPolygonDistance(point, halfSize, sides, isStar, band);
          expect(Math.sign(banded)).toBe(Math.sign(exact));
          if (Math.abs(exact) < band) {
            expect(banded).toBeCloseTo(exact, 6);
            compared += 1;
          } else {
            expect(Math.abs(banded)).toBeGreaterThanOrEqual(band - 1e-9);
          }
        }
      }
      expect(compared).toBeGreaterThan(20);
    }
  });

  // An outline centred on the edge or outside it needs the distance exact outside the
  // edge as far as the band, not only within the shape's box. The shader's band is the outline's
  // whole width plus the soft edge and a pixel, at least the outside part plus a pixel, so the
  // walk needs no widening: this checks points out to past the band on every side.
  it.each(CASES)('is the exact distance outside the edge out to the band of $name', (shape) => {
    const { halfSize, sides, isStar } = shape;
    for (const band of BANDS) {
      let outside = 0;
      for (let row = 0; row <= 60; row += 1) {
        for (let column = 0; column <= 60; column += 1) {
          const point = {
            x: (column / 30 - 1) * (halfSize.x + 1.2 * band),
            y: (row / 30 - 1) * (halfSize.y + 1.2 * band),
          };
          const exact = polygonDistance(point, halfSize, sides, isStar);
          const banded = bandedPolygonDistance(point, halfSize, sides, isStar, band);
          expect(Math.sign(banded)).toBe(Math.sign(exact));
          if (Math.abs(exact) < band) {
            expect(banded).toBeCloseTo(exact, 6);
            if (exact > band / 2) outside += 1;
          } else {
            expect(Math.abs(banded)).toBeGreaterThanOrEqual(band - 1e-9);
          }
        }
      }
      // Points far enough out to matter for an outline outside the edge were compared.
      expect(outside).toBeGreaterThan(20);
    }
  });
});

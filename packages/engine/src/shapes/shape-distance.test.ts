import { describe, expect, it } from 'vitest';

import {
  ellipseDistance,
  polygonDistance,
  polygonFitOf,
  roundedBoxDistance,
  shapeDistance,
  STAR_INNER_SCALE,
  starInnerRadius,
  unitPolygonInradius,
  unitPolygonVertex,
} from './shape-distance.js';

/** A point, world units. */
interface Vector {
  readonly x: number;
  readonly y: number;
}

/**
 * Distance from a point to the segment a–b, for the analytic checks.
 *
 * @param point - The point.
 * @param a - One end.
 * @param b - The other end.
 * @returns The distance.
 */
function segmentDistance(point: Vector, a: Vector, b: Vector): number {
  const edge = { x: b.x - a.x, y: b.y - a.y };
  const along = ((point.x - a.x) * edge.x + (point.y - a.y) * edge.y) / (edge.x ** 2 + edge.y ** 2);
  const t = Math.min(1, Math.max(0, along));
  return Math.hypot(point.x - (a.x + edge.x * t), point.y - (a.y + edge.y * t));
}

describe('roundedBoxDistance', () => {
  it('is minus the nearest side inside, zero on the outline and the corner gap outside', () => {
    const half = { x: 50, y: 30 };
    expect(roundedBoxDistance({ x: 0, y: 0 }, half, 0)).toBe(-30);
    expect(roundedBoxDistance({ x: 50, y: 0 }, half, 0)).toBe(0);
    expect(roundedBoxDistance({ x: 53, y: 34 }, half, 0)).toBeCloseTo(5, 12);
  });

  it('rounds the corner by the radius: the corner point is outside by r(√2 − 1)', () => {
    const distance = roundedBoxDistance({ x: 50, y: 30 }, { x: 50, y: 30 }, 10);
    expect(distance).toBeCloseTo(10 * (Math.SQRT2 - 1), 12);
  });
});

describe('ellipseDistance', () => {
  it('is zero on the outline at both semi-axes and a full semi-minor axis inside at the centre', () => {
    const radii = { x: 40, y: 20 };
    expect(ellipseDistance({ x: 40, y: 0 }, radii)).toBeCloseTo(0, 12);
    expect(ellipseDistance({ x: 0, y: -20 }, radii)).toBeCloseTo(0, 12);
    expect(ellipseDistance({ x: 0, y: 0 }, radii)).toBe(-20);
  });

  it('is exact for a circle', () => {
    expect(ellipseDistance({ x: 30, y: 40 }, { x: 25, y: 25 })).toBeCloseTo(25, 12);
  });
});

describe('unitPolygonVertex', () => {
  it('starts at the top and turns clockwise (y down) at the outer radius', () => {
    const top = unitPolygonVertex(0, 4, false);
    expect(top.x).toBeCloseTo(0, 12);
    expect(top.y).toBeCloseTo(-1, 12);
    const right = unitPolygonVertex(1, 4, false);
    expect(right.x).toBeCloseTo(1, 12);
    expect(right.y).toBeCloseTo(0, 12);
  });

  it("alternates a star's points with inner vertices halfway between them", () => {
    const inner = unitPolygonVertex(1, 5, true);
    const radius = starInnerRadius(5);
    expect(radius).toBeCloseTo(STAR_INNER_SCALE * Math.cos(Math.PI / 5), 12);
    expect(Math.hypot(inner.x, inner.y)).toBeCloseTo(radius, 12);
    expect(Math.atan2(inner.x, -inner.y)).toBeCloseTo(Math.PI / 5, 12);
    const point = unitPolygonVertex(2, 5, true);
    expect(Math.hypot(point.x, point.y)).toBeCloseTo(1, 12);
  });
});

describe('polygonFitOf', () => {
  it('fits a square diamond to its box exactly', () => {
    const fit = polygonFitOf({ x: 50, y: 30 }, 4, false);
    expect(fit.centre.x).toBeCloseTo(0, 12);
    expect(fit.centre.y).toBeCloseTo(0, 12);
    expect(fit.scale.x).toBeCloseTo(50, 12);
    expect(fit.scale.y).toBeCloseTo(30, 12);
  });

  it("fits a triangle's apex to the top and its base to the bottom of the box", () => {
    const half = { x: 60, y: 40 };
    const fit = polygonFitOf(half, 3, false);
    const apex = unitPolygonVertex(0, 3, false);
    const left = unitPolygonVertex(2, 3, false);
    const place = (point: { x: number; y: number }) => ({
      x: (point.x - fit.centre.x) * fit.scale.x,
      y: (point.y - fit.centre.y) * fit.scale.y,
    });
    expect(place(apex).y).toBeCloseTo(-40, 9);
    expect(place(apex).x).toBeCloseTo(0, 9);
    expect(place(left).y).toBeCloseTo(40, 9);
    expect(place(left).x).toBeCloseTo(-60, 9);
  });
});

describe('polygonDistance', () => {
  it("is a diamond's exact distance: vertices on the outline, the centre at the edge's normal", () => {
    const half = { x: 50, y: 30 };
    expect(polygonDistance({ x: 0, y: -30 }, half, 4, false)).toBeCloseTo(0, 9);
    expect(polygonDistance({ x: 50, y: 0 }, half, 4, false)).toBeCloseTo(0, 9);
    // The rhombus's inradius: a·b / √(a² + b²).
    const inradius = (50 * 30) / Math.hypot(50, 30);
    expect(polygonDistance({ x: 0, y: 0 }, half, 4, false)).toBeCloseTo(-inradius, 9);
    // Outside, past a vertex: the distance to that vertex.
    expect(polygonDistance({ x: 60, y: 0 }, half, 4, false)).toBeCloseTo(10, 9);
  });

  it("is a triangle's distance to its nearest edge, inside and out", () => {
    const half = { x: 60, y: 40 };
    const apex = { x: 0, y: -40 };
    const right = { x: 60, y: 40 };
    const outside = { x: 50, y: -10 };
    expect(polygonDistance(outside, half, 3, false)).toBeCloseTo(
      segmentDistance(outside, apex, right),
      9,
    );
    const inside = { x: 0, y: 20 };
    expect(polygonDistance(inside, half, 3, false)).toBeCloseTo(-20, 9);
  });

  it("is zero on a star's inner vertices and negative at its centre", () => {
    const half = { x: 50, y: 50 };
    const fit = polygonFitOf(half, 5, true);
    const inner = unitPolygonVertex(1, 5, true);
    const placed = {
      x: (inner.x - fit.centre.x) * fit.scale.x,
      y: (inner.y - fit.centre.y) * fit.scale.y,
    };
    expect(polygonDistance(placed, half, 5, true)).toBeCloseTo(0, 9);
    const centre = { x: -fit.centre.x * fit.scale.x, y: -fit.centre.y * fit.scale.y };
    expect(polygonDistance(centre, half, 5, true)).toBeLessThan(0);
    // Between two points, beyond the inner vertex, the star is outside.
    const notch = { x: placed.x * 1.4, y: placed.y * 1.4 };
    expect(polygonDistance(notch, half, 5, true)).toBeGreaterThan(0);
  });

  it('draws a 12-sided polygon close to its circle', () => {
    const half = { x: 50, y: 50 };
    const radius = 50 / Math.cos(Math.PI / 12);
    expect(Math.abs(polygonDistance({ x: 0, y: -radius * 0.99 }, half, 12, false))).toBeLessThan(2);
  });
});

describe('shapeDistance', () => {
  it('picks the distance function by kind: box, ellipse, diamond, polygon, star', () => {
    const half = { x: 50, y: 30 };
    const point = { x: 10, y: 5 };
    expect(shapeDistance('rounded-box', point, half, 4, 0)).toBe(
      roundedBoxDistance(point, half, 4),
    );
    expect(shapeDistance('ellipse', point, half, 0, 0)).toBe(ellipseDistance(point, half));
    expect(shapeDistance('diamond', point, half, 0, 0)).toBe(
      polygonDistance(point, half, 4, false),
    );
    expect(shapeDistance('polygon', point, half, 0, 6)).toBe(
      polygonDistance(point, half, 6, false),
    );
    expect(shapeDistance('star', point, half, 0, 5)).toBe(polygonDistance(point, half, 5, true));
  });
});

describe('unitPolygonInradius', () => {
  it("is a regular polygon's apothem, cos(π/n), and a star's inner vertices' radius", () => {
    expect(unitPolygonInradius(6, false)).toBeCloseTo(Math.cos(Math.PI / 6), 12);
    // A star's nearest boundary point to its centre is a notch: the edges run outward from it.
    expect(unitPolygonInradius(5, true)).toBeCloseTo(starInnerRadius(5), 12);
  });
});

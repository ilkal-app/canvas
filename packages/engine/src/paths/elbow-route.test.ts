import { describe, expect, it } from 'vitest';

import { elbowRoute, lineRouteOf } from './elbow-route.js';

describe('elbowRoute', () => {
  it('runs horizontal, vertical, horizontal through the middle x when wider than tall', () => {
    expect(elbowRoute({ x: 0, y: 0 }, { x: 100, y: 40 })).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 40 },
    ]);
  });

  it('runs vertical, horizontal, vertical through the middle y when taller than wide', () => {
    expect(elbowRoute({ x: 10, y: 0 }, { x: -30, y: 100 })).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 50 },
      { x: -30, y: 50 },
      { x: -30, y: 100 },
    ]);
  });

  it('leaves horizontally on a tie, whatever the direction of travel', () => {
    expect(elbowRoute({ x: 0, y: 0 }, { x: -20, y: -20 })).toEqual([
      { x: 0, y: 0 },
      { x: -10, y: 0 },
      { x: -10, y: -20 },
      { x: -20, y: -20 },
    ]);
  });

  it('is the straight piece between points on one horizontal or vertical line', () => {
    expect(elbowRoute({ x: 0, y: 5 }, { x: 80, y: 5 })).toEqual([
      { x: 0, y: 5 },
      { x: 80, y: 5 },
    ]);
    expect(elbowRoute({ x: 3, y: 0 }, { x: 3, y: -60 })).toEqual([
      { x: 3, y: 0 },
      { x: 3, y: -60 },
    ]);
  });

  it('is a lone point when both points coincide', () => {
    expect(elbowRoute({ x: 7, y: 7 }, { x: 7, y: 7 })).toEqual([{ x: 7, y: 7 }]);
  });

  it('stays inside the box of its two points and does not mutate them', () => {
    const from = Object.freeze({ x: -12, y: 40 });
    const to = Object.freeze({ x: 30, y: -2 });
    for (const point of elbowRoute(from, to)) {
      expect(point.x).toBeGreaterThanOrEqual(-12);
      expect(point.x).toBeLessThanOrEqual(30);
      expect(point.y).toBeGreaterThanOrEqual(-2);
      expect(point.y).toBeLessThanOrEqual(40);
    }
  });
});

describe('lineRouteOf', () => {
  const points: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 0, y: 0 },
    { x: 60, y: 20 },
  ];

  it('is the two points of a straight line', () => {
    expect(lineRouteOf({ points, route: 'straight' })).toEqual(points);
  });

  it('is the elbow route of an elbow line', () => {
    expect(lineRouteOf({ points, route: 'elbow' })).toEqual(elbowRoute(points[0], points[1]));
  });
});

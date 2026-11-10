import { describe, expect, it } from 'vitest';

import { evalCubic } from './bezier.js';
import {
  flattenFreehand,
  freehandCenterDistance,
  freehandCurve,
  freehandLocalBounds,
} from './freehand-curve.js';

const STROKE = { color: 'ink', width: 10 } as const;

describe('freehandCurve', () => {
  it('has no piece for a dot and a straight piece for two points', () => {
    expect(freehandCurve([4, 4])).toEqual([]);
    expect(freehandCurve([0, 0, 30, 0])).toEqual([
      { from: { x: 0, y: 0 }, c1: { x: 10, y: 0 }, c2: { x: 20, y: 0 }, to: { x: 30, y: 0 } },
    ]);
  });

  it('passes through every point in joined pieces', () => {
    const points = [0, 0, 10, 10, 20, -5, 35, 8, 40, 0];
    const segments = freehandCurve(points);
    expect(segments).toHaveLength(4);
    segments.forEach((segment, index) => {
      expect(segment.from).toEqual({ x: points[2 * index], y: points[2 * index + 1] });
      expect(segment.to).toEqual({ x: points[2 * index + 2], y: points[2 * index + 3] });
    });
  });

  it('puts a handle on the chord where a neighbour repeats its point', () => {
    const [first, second] = freehandCurve([0, 0, 0, 0, 9, 0]);
    expect(first?.c1).toEqual({ x: 0, y: 0 });
    expect(second?.c1).toEqual({ x: 3, y: 0 });
  });
});

describe('flattenFreehand', () => {
  it('runs from the first point to the last, near the curve', () => {
    const points = [0, 0, 20, 30, 40, 0];
    const line = flattenFreehand(points, 0.1);
    expect(line.slice(0, 2)).toEqual([0, 0]);
    expect(line.slice(-2)).toEqual([40, 0]);
    for (const { from, c1, c2, to } of freehandCurve(points)) {
      for (let t = 0; t <= 1; t += 0.05) {
        const onCurve = evalCubic([from, c1, c2, to], t);
        let nearest = Number.POSITIVE_INFINITY;
        for (let index = 2; index + 1 < line.length; index += 2) {
          const [ax, ay, bx, by] = line.slice(index - 2, index + 2) as [
            number,
            number,
            number,
            number,
          ];
          const t = Math.max(
            0,
            Math.min(
              1,
              ((onCurve.x - ax) * (bx - ax) + (onCurve.y - ay) * (by - ay)) /
                ((bx - ax) ** 2 + (by - ay) ** 2),
            ),
          );
          nearest = Math.min(
            nearest,
            Math.hypot(onCurve.x - ax - (bx - ax) * t, onCurve.y - ay - (by - ay) * t),
          );
        }
        expect(nearest).toBeLessThanOrEqual(0.1 + 1e-9);
      }
    }
  });

  it('gives a dot as itself', () => {
    expect(flattenFreehand([3, 4], 0.1)).toEqual([3, 4]);
  });
});

describe('freehandCenterDistance', () => {
  it('measures to the centre line, a stored point and a dot', () => {
    expect(freehandCenterDistance([0, 0, 100, 0], { x: 50, y: 7 })).toBeCloseTo(7);
    expect(freehandCenterDistance([0, 0, 100, 0], { x: 100, y: 0 })).toBe(0);
    expect(freehandCenterDistance([0, 0, 0, 0, 0, 0], { x: 3, y: 4 })).toBe(5);
    expect(freehandCenterDistance([5, 5], { x: 8, y: 9 })).toBe(5);
  });
});

describe('freehandLocalBounds', () => {
  it('grows the curve by half the width', () => {
    expect(freehandLocalBounds({ points: [0, 0, 100, 0], stroke: STROKE })).toEqual({
      x: -5,
      y: -5,
      width: 110,
      height: 10,
    });
    expect(freehandLocalBounds({ points: [2, 2], stroke: STROKE })).toEqual({
      x: -3,
      y: -3,
      width: 10,
      height: 10,
    });
  });

  it('holds the curve where it swings past its points', () => {
    const points = [0, 0, 10, 0, 10, 10, 0, 10];
    const box = freehandLocalBounds({ points, stroke: { color: 'ink', width: 0.01 } });
    for (const { from, c1, c2, to } of freehandCurve(points)) {
      for (let t = 0; t <= 1; t += 0.01) {
        const point = evalCubic([from, c1, c2, to], t);
        expect(point.x).toBeGreaterThanOrEqual(box.x - 0.25);
        expect(point.x).toBeLessThanOrEqual(box.x + box.width + 0.25);
        expect(point.y).toBeGreaterThanOrEqual(box.y - 0.25);
        expect(point.y).toBeLessThanOrEqual(box.y + box.height + 0.25);
      }
    }
  });

  it('is empty for a stroke with no points', () => {
    expect(freehandLocalBounds({ points: [], stroke: STROKE })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import { buildNetwork } from './__fixtures__/networks.js';
import {
  cubicBounds,
  cubicOf,
  evalCubic,
  flattenCubic,
  isStraightCubic,
  nearestOnCubic,
  splitCubic,
  type Cubic,
} from './bezier.js';
import { indexNetwork } from './network-index.js';

// Ported from the prototype's `webgl-whiteboard/src/vector/bezier.test.ts`.
const ARCH: Cubic = [
  { x: 0, y: 0 },
  { x: 0, y: 100 },
  { x: 100, y: 100 },
  { x: 100, y: 0 },
];
const LINE: Cubic = [
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 30, y: 40 },
  { x: 30, y: 40 },
];
const LOOPING: Cubic = [
  { x: 0, y: 0 },
  { x: 300, y: 200 },
  { x: -200, y: 200 },
  { x: 100, y: 0 },
];
const S_CURVE: Cubic = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: -100, y: 50 },
  { x: 100, y: 50 },
];

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function distanceToPolyline(point: Point, polyline: readonly Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < polyline.length; index += 1) {
    const a = polyline[index] ?? point;
    const b = polyline[index + 1] ?? point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    best = Math.min(best, distance(point, { x: a.x + t * dx, y: a.y + t * dy }));
  }
  return best;
}

describe('cubicOf', () => {
  it('adds the handle offsets to the vertex positions', () => {
    const network = buildNetwork(
      [
        [0, 0],
        [100, 0],
      ],
      [[0, 1]],
      {
        0: [
          { x: 0, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    );
    const [segment] = network.segments;
    if (!segment) throw new Error('No segment.');
    expect(cubicOf(indexNetwork(network), segment)).toEqual(ARCH);
  });

  it('rejects a segment whose vertex is missing', () => {
    const network = buildNetwork([[0, 0]], []);
    const orphan = { id: 's9', a: 'v0', b: 'gone', ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } };
    expect(() => cubicOf(indexNetwork(network), orphan)).toThrow(RangeError);
  });
});

describe('evalCubic and splitCubic', () => {
  it('evaluates the ends and the middle', () => {
    expect(evalCubic(ARCH, 0)).toEqual({ x: 0, y: 0 });
    expect(evalCubic(ARCH, 1)).toEqual({ x: 100, y: 0 });
    expect(evalCubic(ARCH, 0.5)).toEqual({ x: 50, y: 75 });
  });

  it('splits into halves that re-evaluate to the original curve', () => {
    const [left, right] = splitCubic(ARCH, 0.3);
    expect(left[0]).toEqual(ARCH[0]);
    expect(right[3]).toEqual(ARCH[3]);
    expect(distance(left[3], right[0])).toBe(0);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      expect(distance(evalCubic(left, u), evalCubic(ARCH, 0.3 * u))).toBeLessThan(1e-9);
      expect(distance(evalCubic(right, u), evalCubic(ARCH, 0.3 + 0.7 * u))).toBeLessThan(1e-9);
    }
  });
});

describe('flattenCubic', () => {
  it('gives just the two end points for a straight segment', () => {
    expect(isStraightCubic(LINE)).toBe(true);
    expect(isStraightCubic(ARCH)).toBe(false);
    expect(flattenCubic(LINE, 0.25)).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 40 },
    ]);
  });

  it('stays within the tolerance of the curve and gets finer as it shrinks', () => {
    for (const tolerance of [2, 0.25, 0.01]) {
      const polyline = flattenCubic(ARCH, tolerance);
      expect(polyline[0]).toEqual(ARCH[0]);
      expect(polyline.at(-1)).toEqual(ARCH[3]);
      for (let step = 0; step <= 400; step += 1) {
        const onCurve = evalCubic(ARCH, step / 400);
        expect(distanceToPolyline(onCurve, polyline)).toBeLessThanOrEqual(tolerance * 1.0001);
      }
    }
    expect(flattenCubic(ARCH, 0.25).length).toBeGreaterThan(flattenCubic(ARCH, 2).length);
  });

  it('terminates on a curve collapsed to a point', () => {
    const point = { x: 5, y: 5 };
    expect(flattenCubic([point, point, point, point], 0.25)).toEqual([point, point]);
  });

  it('stops subdividing at a cusp it can never flatten below a tiny tolerance', () => {
    const polyline = flattenCubic(LOOPING, 1e-12);
    expect(polyline.length).toBeLessThanOrEqual(2 ** 16 + 1);
    expect(polyline.at(-1)).toEqual(LOOPING[3]);
  });
});

describe('cubicBounds', () => {
  it('is tight: it bounds the curve, not the control polygon', () => {
    const bounds = cubicBounds(ARCH);
    expect(bounds.minX).toBeCloseTo(0, 9);
    expect(bounds.minY).toBeCloseTo(0, 9);
    expect(bounds.maxX).toBeCloseTo(100, 9);
    expect(bounds.maxY).toBeCloseTo(75, 9);
  });

  it('contains dense samples of an S-curve and of a curve with a linear derivative', () => {
    const parabolic: Cubic = [
      { x: 0, y: 0 },
      { x: 10, y: 30 },
      { x: 20, y: 30 },
      { x: 30, y: 0 },
    ];
    for (const curve of [S_CURVE, parabolic]) {
      const bounds = cubicBounds(curve);
      for (let step = 0; step <= 100; step += 1) {
        const { x, y } = evalCubic(curve, step / 100);
        expect(x).toBeGreaterThanOrEqual(bounds.minX - 1e-9);
        expect(x).toBeLessThanOrEqual(bounds.maxX + 1e-9);
        expect(y).toBeGreaterThanOrEqual(bounds.minY - 1e-9);
        expect(y).toBeLessThanOrEqual(bounds.maxY + 1e-9);
      }
    }
    expect(cubicBounds(LINE)).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 40 });
  });
});

describe('nearestOnCubic', () => {
  it('finds the apex and the end points', () => {
    const top = nearestOnCubic(ARCH, { x: 50, y: 200 });
    expect(top.t).toBeCloseTo(0.5, 3);
    expect(top.distance).toBeCloseTo(125, 3);
    expect(nearestOnCubic(ARCH, { x: -10, y: -10 }).t).toBeCloseTo(0, 3);
    expect(nearestOnCubic(ARCH, { x: 110, y: -10 }).t).toBeCloseTo(1, 3);
  });

  it('projects onto a straight segment', () => {
    const nearest = nearestOnCubic(LINE, { x: 15, y: 20 });
    expect(nearest.distance).toBeLessThan(1e-3);
    expect(distance(nearest.point, { x: 15, y: 20 })).toBeLessThan(1e-3);
  });

  it('matches a brute-force search on a looping curve and an S-curve', () => {
    for (const curve of [LOOPING, S_CURVE]) {
      for (let x = -50; x <= 150; x += 25) {
        for (let y = -50; y <= 200; y += 25) {
          let brute = Number.POSITIVE_INFINITY;
          for (let step = 0; step <= 20_000; step += 1) {
            brute = Math.min(brute, distance(evalCubic(curve, step / 20_000), { x, y }));
          }
          expect(nearestOnCubic(curve, { x, y }).distance).toBeLessThanOrEqual(brute + 1e-3);
        }
      }
    }
  });
});

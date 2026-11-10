// Pure freehand simplification, curves, bounds and splitting.
import { describe, expect, it } from 'vitest';

import * as schema from '@canvas/schema';

interface Point {
  x: number;
  y: number;
}
type Sample = Point & { pressure?: number };
interface Curve {
  from: Point;
  c1: Point;
  c2: Point;
  to: Point;
}
interface Fields {
  points: number[];
  pressures?: number[];
}
const get = (name: string): unknown => Reflect.get(schema, name);
const simplify = get('simplifyFreehand') as (samples: Sample[], tolerance: number) => Sample[];
const tolerance = get('freehandTolerance') as (zoom: number) => number;
const smooth = get('smoothFreehand') as (samples: Sample[], factor: number) => Sample[];
const curve = get('freehandCurve') as (points: number[]) => Curve[];
const flatten = get('flattenFreehand') as (points: number[], tolerance: number) => number[];
const distance = get('freehandCenterDistance') as (points: number[], local: Point) => number;
const bounds = get('freehandLocalBounds') as (object: Record<string, unknown>) => {
  x: number;
  y: number;
  width: number;
  height: number;
};
const split = get('splitFreehand') as (samples: Sample[], max?: number) => Sample[][];
const fieldsOf = get('freehandFieldsOf') as (samples: Sample[]) => Fields;
const samplesOf = get('freehandSamplesOf') as (fields: Fields) => Sample[];

const object = (points: number[], width = 10) => ({
  id: 'ink-one',
  type: 'freehand',
  parentId: null,
  x: 30,
  y: 40,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:ada',
  createdAt: 1_760_000_000_000,
  updatedAt: 1_760_000_000_000,
  tool: 'pencil',
  points,
  stroke: { color: 'ink', width },
});

function cubicAt(segment: Curve, time: number): Point {
  const rest = 1 - time;
  return {
    x:
      rest ** 3 * segment.from.x +
      3 * rest ** 2 * time * segment.c1.x +
      3 * rest * time ** 2 * segment.c2.x +
      time ** 3 * segment.to.x,
    y:
      rest ** 3 * segment.from.y +
      3 * rest ** 2 * time * segment.c1.y +
      3 * rest * time ** 2 * segment.c2.y +
      time ** 3 * segment.to.y,
  };
}

function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t =
    dx === 0 && dy === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)),
        );
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

describe('freehand geometry', () => {
  it('simplifies a collinear run and drops a deviation within tolerance', () => {
    expect(
      simplify(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0.4 },
          { x: 10, y: 0 },
        ],
        0.5,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });
  it('keeps a corner outside tolerance and a pressure bump on a straight run', () => {
    expect(
      simplify(
        [
          { x: 0, y: 0 },
          { x: 5, y: 2 },
          { x: 10, y: 0 },
        ],
        0.5,
      ),
    ).toHaveLength(3);
    expect(
      simplify(
        [
          { x: 0, y: 0, pressure: 0.2 },
          { x: 5, y: 0, pressure: 0.8 },
          { x: 10, y: 0, pressure: 0.2 },
        ],
        0.5,
      ),
    ).toHaveLength(3);
  });
  it('collapses duplicate positions and copies empty and single-sample inputs without mutation', () => {
    const input = Object.freeze([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(simplify(input as Sample[], 0.5)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(simplify([], 0.5)).toEqual([]);
    const one = [{ x: 2, y: 3 }];
    expect(simplify(one, 0.5)).toEqual(one);
    expect(simplify(one, 0.5)[0]).not.toBe(one[0]);
    expect(input).toHaveLength(3);
  });
  it('turns screen tolerance into world units and rejects invalid zoom', () => {
    expect(tolerance(1)).toBe(0.5);
    expect(tolerance(4)).toBe(0.125);
    for (const zoom of [0, -1, Number.NaN]) expect(() => tolerance(zoom)).toThrow(RangeError);
  });
  it('smooths each interior sample from the previous output while fixing endpoints', () => {
    const input = [
      { x: 0, y: 0, pressure: 0 },
      { x: 10, y: 20, pressure: 1 },
      { x: 20, y: 0, pressure: 0 },
      { x: 30, y: 0, pressure: 1 },
    ];
    expect(smooth(input, 0)).toEqual(input);
    expect(smooth(input, 0)).not.toBe(input);
    expect(smooth(input, 0.5)).toEqual([
      input[0],
      { x: 5, y: 10, pressure: 0.5 },
      { x: 12.5, y: 5, pressure: 0.25 },
      input[3],
    ]);
    for (const factor of [1, -0.1]) expect(() => smooth(input, factor)).toThrow(RangeError);
  });
  it('curves through every sample with continuous zigzag segments and chord-third controls', () => {
    expect(curve([2, 3])).toEqual([]);
    expect(curve([0, 0, 9, 6])).toEqual([
      { from: { x: 0, y: 0 }, c1: { x: 3, y: 2 }, c2: { x: 6, y: 4 }, to: { x: 9, y: 6 } },
    ]);
    const segments = curve([0, 0, 10, 20, 20, -10, 30, 0]);
    expect(segments).toHaveLength(3);
    expect(segments.map((part) => part.from)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: -10 },
    ]);
    expect(segments.at(-1)?.to).toEqual({ x: 30, y: 0 });
    for (let i = 0; i < segments.length - 1; i += 1)
      expect(segments[i]?.to).toEqual(segments[i + 1]?.from);
  });
  it('flattens the curve from end to end within the requested tolerance', () => {
    const points = [0, 0, 10, 20, 20, -10, 30, 0];
    const flat = flatten(points, 0.25);
    expect(flat.slice(0, 2)).toEqual([0, 0]);
    expect(flat.slice(-2)).toEqual([30, 0]);
    const vertices = Array.from({ length: flat.length / 2 }, (unused, i) => ({
      x: flat[2 * i] ?? Number.NaN,
      y: flat[2 * i + 1] ?? Number.NaN,
    }));
    for (const part of curve(points))
      for (let i = 0; i <= 100; i += 1) {
        const probe = cubicAt(part, i / 100);
        expect(
          Math.min(
            ...vertices
              .slice(1)
              .map((vertex, index) => segmentDistance(probe, vertices[index] as Point, vertex)),
          ),
        ).toBeLessThanOrEqual(0.35);
      }
    expect(flatten([3, 4], 0.25)).toEqual([3, 4]);
  });
  it('measures the centerline and inflates local and world bounds by half stroke width', () => {
    expect(distance([0, 0, 100, 0], { x: 0, y: 0 })).toBe(0);
    expect(distance([0, 0, 100, 0], { x: 50, y: 7 })).toBeCloseTo(7);
    expect(distance([3, 4], { x: 6, y: 8 })).toBeCloseTo(5);
    const line = object([0, 0, 100, 0]);
    expect(bounds(line)).toEqual({ x: -5, y: -5, width: 110, height: 10 });
    const board = schema.createBoard([line as unknown as schema.BoardObject]);
    expect(
      schema.localBounds(
        board,
        line as unknown as schema.BoardObject,
        schema.buildChildIndex(board),
      ),
    ).toEqual(bounds(line));
    const curved = object([0, 0, 10, 30, 20, 0]);
    const box = bounds(curved);
    for (const part of curve(curved.points))
      for (let i = 0; i <= 100; i += 1) {
        const point = cubicAt(part, i / 100);
        expect(point.x).toBeGreaterThanOrEqual(box.x - 0.25);
        expect(point.x).toBeLessThanOrEqual(box.x + box.width + 0.25);
        expect(point.y).toBeGreaterThanOrEqual(box.y - 0.25);
        expect(point.y).toBeLessThanOrEqual(box.y + box.height + 0.25);
      }
  });
  it('splits 2500 samples into joined chunks no larger than 1024', () => {
    const input = Array.from({ length: 2500 }, (unused, i) => ({ x: i, y: i % 7 }));
    const chunks = split(input);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.length <= 1024)).toBe(true);
    for (let i = 1; i < chunks.length; i += 1)
      expect(chunks[i]?.[0]).toEqual(chunks[i - 1]?.at(-1));
    expect(chunks.flatMap((chunk, index) => (index === 0 ? chunk : chunk.slice(1)))).toEqual(input);
    expect(split(input.slice(0, 1024))).toEqual([input.slice(0, 1024)]);
    expect(() => split(input, 1)).toThrow(RangeError);
  });
  it('converts samples to fields and back, omitting partial pressure arrays', () => {
    const plain = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    const pressured = [
      { x: 1, y: 2, pressure: 0 },
      { x: 3, y: 4, pressure: 1 },
    ];
    expect(samplesOf(fieldsOf(plain))).toEqual(plain);
    expect(samplesOf(fieldsOf(pressured))).toEqual(pressured);
    expect(
      fieldsOf([
        { x: 1, y: 2, pressure: 0.5 },
        { x: 3, y: 4 },
      ]),
    ).toEqual({ points: [1, 2, 3, 4] });
  });
});

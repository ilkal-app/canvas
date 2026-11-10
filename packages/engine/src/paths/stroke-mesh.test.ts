import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import { covers, coveredArea, meshBounds } from './__fixtures__/mesh-coverage.js';
import { strokeMesh } from './stroke-mesh.js';

// Ported from the prototype's `webgl-whiteboard/src/vector/stroke.test.ts`, with round joins
// (the prototype mitred every turn under 60°) and cap styles.
const TOLERANCE = 0.05;
const points = (...pairs: (readonly [number, number])[]): Point[] =>
  pairs.map(([x, y]) => ({ x, y }));
const rounded = (bounds: ReturnType<typeof meshBounds>): number[] =>
  [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].map(
    (value) => Math.round(value * 100) / 100,
  );

describe('strokeMesh', () => {
  it('covers a straight segment and its round caps, and nothing beyond', () => {
    const mesh = strokeMesh(points([0, 0], [10, 0]), 2, false, 'round', TOLERANCE);
    expect(mesh.length % 6).toBe(0);
    expect(rounded(meshBounds(mesh))).toEqual([-1, -1, 11, 1]);
    expect(covers(mesh, 5, 0.9)).toBe(true);
    expect(covers(mesh, -0.9, 0)).toBe(true);
    expect(covers(mesh, 5, 1.2)).toBe(false);
    // Outside the round cap's corner.
    expect(covers(mesh, -0.9, 0.9)).toBe(false);
  });

  it('covers the area of the stroked shape to within the tolerance', () => {
    const width = 4;
    const length = 20;
    const mesh = strokeMesh(points([0, 0], [length, 0]), width, false, 'round', TOLERANCE);
    const exact = length * width + Math.PI * (width / 2) ** 2;
    // The caps' polygons lie inside their arcs, by at most the tolerance along the perimeter.
    const perimeter = 2 * length + Math.PI * width;
    const area = coveredArea(mesh, 0.02);
    expect(area).toBeLessThanOrEqual(exact + 0.05);
    expect(area).toBeGreaterThanOrEqual(exact - TOLERANCE * perimeter - 0.05);
  });

  it('ends a butt-capped stroke at its end points', () => {
    const mesh = strokeMesh(points([0, 0], [10, 0]), 2, false, 'butt', TOLERANCE);
    expect(rounded(meshBounds(mesh))).toEqual([0, -1, 10, 1]);
    expect(covers(mesh, -0.5, 0)).toBe(false);
    const mixed = strokeMesh(
      points([0, 0], [10, 0]),
      2,
      false,
      { start: 'butt', end: 'round' },
      TOLERANCE,
    );
    expect(rounded(meshBounds(mixed))).toEqual([0, -1, 11, 1]);
  });

  it('rounds a sharp corner instead of mitring it', () => {
    const mesh = strokeMesh(points([0, 0], [10, 0], [10, 10]), 2, false, 'round', TOLERANCE);
    // Inside the round join.
    expect(covers(mesh, 10.6, -0.6)).toBe(true);
    // A mitre would cover this.
    expect(covers(mesh, 10.95, -0.95)).toBe(false);
  });

  it('keeps a gentle bend continuous on both sides', () => {
    const mesh = strokeMesh(points([0, 0], [10, 0], [20, 2]), 4, false, 'round', TOLERANCE);
    expect(covers(mesh, 10, 1.9)).toBe(true);
    expect(covers(mesh, 10, -1.9)).toBe(true);
    expect(covers(mesh, 10, -2.2)).toBe(false);
  });

  it('closes a closed square without caps', () => {
    const square = points([0, 0], [10, 0], [10, 10], [0, 10]);
    const mesh = strokeMesh(square, 2, true, 'round', TOLERANCE);
    expect(rounded(meshBounds(mesh))).toEqual([-1, -1, 11, 11]);
    // The closing edge is drawn.
    expect(covers(mesh, 0, 5)).toBe(true);
    // The square's inside is not.
    expect(covers(mesh, 5, 5)).toBe(false);
    // A closing point that repeats the first is dropped, not stroked as a zero-length edge.
    const repeated = strokeMesh([...square, { x: 0, y: 0 }], 2, true, 'round', TOLERANCE);
    expect(rounded(meshBounds(repeated))).toEqual([-1, -1, 11, 11]);
  });

  it('stays finite on a reversal, repeated points, a single point and no points', () => {
    for (const polyline of [
      points([0, 0], [10, 0], [0, 0]),
      points([0, 0], [0, 0], [10, 0]),
      points([3, 3]),
      [],
    ]) {
      const mesh = strokeMesh(polyline, 2, false, 'round', TOLERANCE);
      expect([...mesh].every(Number.isFinite)).toBe(true);
    }
    const reversal = strokeMesh(points([0, 0], [10, 0], [0, 0]), 2, false, 'round', TOLERANCE);
    // The turn-back is rounded: its far side reaches a half-width past the turning point.
    expect(meshBounds(reversal).maxX).toBeCloseTo(11, 2);
    expect(covers(reversal, 10.9, 0)).toBe(true);
    const closedPair = strokeMesh(points([0, 0], [10, 0]), 2, true, 'round', TOLERANCE);
    expect([...closedPair].every(Number.isFinite)).toBe(true);
  });

  it('draws a round dot for a single point, and nothing for a butt-capped one', () => {
    const dot = strokeMesh(points([3, 3]), 2, false, 'round', TOLERANCE);
    expect(rounded(meshBounds(dot))).toEqual([2, 2, 4, 4]);
    expect(covers(dot, 3, 3.9)).toBe(true);
    expect(strokeMesh(points([3, 3]), 2, false, 'butt', TOLERANCE)).toHaveLength(0);
    expect(strokeMesh([], 2, false, 'round', TOLERANCE)).toHaveLength(0);
  });

  it('divides round parts more finely as the tolerance shrinks', () => {
    const line = points([0, 0], [10, 0]);
    const coarse = strokeMesh(line, 8, false, 'round', 1);
    const fine = strokeMesh(line, 8, false, 'round', 0.01);
    expect(fine.length).toBeGreaterThan(coarse.length);
    // A stroke thinner than the tolerance still gets a closed cap.
    expect(strokeMesh(line, 0.01, false, 'round', 1).length).toBeGreaterThan(12);
  });

  it('does not mutate the polyline', () => {
    const polyline = points([0, 0], [10, 0], [10, 10], [0, 0]);
    const copy = structuredClone(polyline);
    strokeMesh(polyline, 2, true, 'round', TOLERANCE);
    expect(polyline).toEqual(copy);
  });
});

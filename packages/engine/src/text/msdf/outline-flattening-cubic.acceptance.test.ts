import { describe, expect, it } from 'vitest';

import type { CubicSegment, GlyphOutline, QuadraticSegment } from '@canvas/text';

import { flattenOutline, type Edge } from './outline-flattening.js';

const TOLERANCE_PX = 0.1;
const MAX_CURVE_STEPS = 64;

function cubicPoint(curve: CubicSegment, scale: number, t: number): { x: number; y: number } {
  const u = 1 - t;
  return {
    x:
      scale *
      (u * u * u * curve.x0 +
        3 * u * u * t * curve.c1x +
        3 * u * t * t * curve.c2x +
        t * t * t * curve.x1),
    y:
      scale *
      (u * u * u * curve.y0 +
        3 * u * u * t * curve.c1y +
        3 * u * t * t * curve.c2y +
        t * t * t * curve.y1),
  };
}

function distanceToChord(x: number, y: number, edge: Edge): number {
  const dx = edge.x1 - edge.x0;
  const dy = edge.y1 - edge.y0;
  const lengthSquared = dx * dx + dy * dy;
  const projection =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - edge.x0) * dx + (y - edge.y0) * dy) / lengthSquared));
  return Math.hypot(x - edge.x0 - projection * dx, y - edge.y0 - projection * dy);
}

function wangSteps(curve: CubicSegment, scale: number): number {
  const first = Math.hypot(
    curve.x0 - 2 * curve.c1x + curve.c2x,
    curve.y0 - 2 * curve.c1y + curve.c2y,
  );
  const second = Math.hypot(
    curve.c1x - 2 * curve.c2x + curve.x1,
    curve.c1y - 2 * curve.c2y + curve.y1,
  );
  return Math.min(
    MAX_CURVE_STEPS,
    Math.max(1, Math.ceil(Math.sqrt((0.75 * Math.max(first, second) * scale) / TOLERANCE_PX))),
  );
}

function flattenCubic(curve: CubicSegment, scale: number): Edge[] {
  return flattenOutline({ contours: [[curve]] }, scale);
}

describe('cubic glyph outline flattening', () => {
  const cases: readonly { name: string; curve: CubicSegment; scale: number }[] = [
    {
      name: 'quarter arc',
      curve: {
        kind: 'cubic',
        x0: 1,
        y0: 0,
        c1x: 1,
        c1y: 0.5522847498,
        c2x: 0.5522847498,
        c2y: 1,
        x1: 0,
        y1: 1,
      },
      scale: 64,
    },
    {
      name: 'S-curve',
      curve: {
        kind: 'cubic',
        x0: 0,
        y0: 0,
        c1x: 0.2,
        c1y: 0.8,
        c2x: 0.8,
        c2y: -0.8,
        x1: 1,
        y1: 0,
      },
      scale: 48,
    },
    {
      name: 'asymmetric bend',
      curve: {
        kind: 'cubic',
        x0: -0.2,
        y0: 0.1,
        c1x: 0.7,
        c1y: 0.9,
        c2x: 0.9,
        c2y: 0.2,
        x1: 1.1,
        y1: -0.3,
      },
      scale: 96,
    },
    {
      name: 'collinear with evenly spaced controls',
      curve: {
        kind: 'cubic',
        x0: 0,
        y0: 0,
        c1x: 1 / 3,
        c1y: 1 / 6,
        c2x: 2 / 3,
        c2y: 1 / 3,
        x1: 1,
        y1: 0.5,
      },
      scale: 32,
    },
  ];

  it.each(cases)('uses Wang steps and stays within 0.1 raster px for $name', ({ curve, scale }) => {
    const edges = flattenCubic(curve, scale);
    expect(edges).toHaveLength(wangSteps(curve, scale));
    for (const [index, edge] of edges.entries()) {
      for (let sample = 0; sample <= 100; sample += 1) {
        const point = cubicPoint(curve, scale, (index + sample / 100) / edges.length);
        expect(distanceToChord(point.x, point.y, edge)).toBeLessThanOrEqual(TOLERANCE_PX + 1e-6);
      }
    }
    expect(edges[0]).toMatchObject({ x0: curve.x0 * scale, y0: curve.y0 * scale });
    expect(edges.at(-1)).toMatchObject({ x1: curve.x1 * scale, y1: curve.y1 * scale });
  });

  it('clamps a huge curve to 64 chords and keeps its exact endpoints', () => {
    const curve: CubicSegment = {
      kind: 'cubic',
      x0: -1,
      y0: 2,
      c1x: 1000,
      c1y: 2000,
      c2x: -1000,
      c2y: -2000,
      x1: 3,
      y1: -4,
    };
    const edges = flattenCubic(curve, 128);
    expect(wangSteps(curve, 128)).toBe(MAX_CURVE_STEPS);
    expect(edges).toHaveLength(MAX_CURVE_STEPS);
    expect(edges[0]).toMatchObject({ x0: -128, y0: 256 });
    expect(edges.at(-1)).toMatchObject({ x1: 384, y1: -512 });
  });

  it('keeps chord order and direction when a cubic is reversed', () => {
    const selectedCase = cases[1];
    expect(selectedCase).toBeDefined();
    if (selectedCase === undefined) throw new Error('missing S-curve case');
    const { curve, scale } = selectedCase;
    const reversed: CubicSegment = {
      kind: 'cubic',
      x0: curve.x1,
      y0: curve.y1,
      c1x: curve.c2x,
      c1y: curve.c2y,
      c2x: curve.c1x,
      c2y: curve.c1y,
      x1: curve.x0,
      y1: curve.y0,
    };
    const forwardEdges = flattenCubic(curve, scale);
    const backwardEdges = flattenCubic(reversed, scale);
    expect(forwardEdges).toHaveLength(wangSteps(curve, scale));
    expect(backwardEdges).toHaveLength(forwardEdges.length);
    for (const [index, edge] of forwardEdges.entries()) {
      const backward = backwardEdges[backwardEdges.length - 1 - index];
      expect(backward).toBeDefined();
      if (backward === undefined) throw new Error('missing reversed edge');
      expect(backward.x0).toBeCloseTo(edge.x1, 10);
      expect(backward.y0).toBeCloseTo(edge.y1, 10);
      expect(backward.x1).toBeCloseTo(edge.x0, 10);
      expect(backward.y1).toBeCloseTo(edge.y0, 10);
    }
  });

  it('keeps lines, quadratics, and cubics in contour order without changing existing edges', () => {
    const firstLine = { kind: 'line' as const, x0: 0, y0: 0, x1: 1, y1: 0 };
    const quadratic: QuadraticSegment = {
      kind: 'quadratic',
      x0: 1,
      y0: 0,
      cx: 1.4,
      cy: 0.5,
      x1: 1,
      y1: 1,
    };
    const cubic: CubicSegment = {
      kind: 'cubic',
      x0: 1,
      y0: 1,
      c1x: 0.8,
      c1y: 1.2,
      c2x: 0.2,
      c2y: 1.2,
      x1: 0,
      y1: 1,
    };
    const lastLine = { kind: 'line' as const, x0: 0, y0: 1, x1: 0, y1: 0 };
    const scale = 32;
    const outline: GlyphOutline = { contours: [[firstLine, quadratic, cubic, lastLine]] };
    const edges = flattenOutline(outline, scale);
    const quadraticEdges = flattenOutline({ contours: [[quadratic]] }, scale);
    const cubicEdges = flattenCubic(cubic, scale);
    expect(edges).toEqual([
      { x0: 0, y0: 0, x1: scale, y1: 0 },
      ...quadraticEdges,
      ...cubicEdges,
      { x0: 0, y0: scale, x1: 0, y1: 0 },
    ]);
    expect(edges.length).toBeGreaterThan(0);
    for (let index = 1; index < edges.length; index += 1) {
      expect(edges[index]?.x0 ?? Number.NaN).toBe(edges[index - 1]?.x1 ?? Number.NaN);
      expect(edges[index]?.y0 ?? Number.NaN).toBe(edges[index - 1]?.y1 ?? Number.NaN);
    }
  });
});

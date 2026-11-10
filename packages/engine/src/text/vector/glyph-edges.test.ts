import { describe, expect, it } from 'vitest';

import { glyphEdges } from './glyph-edges.js';

describe('glyphEdges', () => {
  it('leaves out a quadratic whose ends meet: it retraces a line and bounds nothing', () => {
    // A teardrop: a line out and back, then a quadratic from the apex back to itself, whose
    // points s + 2t(1 − t)(c − s) run out to the control point's middle and back. Neither side of
    // it is inside (only the boundary is kept), and the lines cancel.
    const outline = {
      contours: [
        [
          { kind: 'line' as const, x0: 0, y0: 0, x1: 1, y1: 0 },
          { kind: 'quadratic' as const, x0: 1, y0: 0, cx: 0.5, cy: 1, x1: 1, y1: 0 },
          { kind: 'line' as const, x0: 1, y0: 0, x1: 0, y1: 0 },
        ],
      ],
    };
    expect(glyphEdges(outline, { maxBulgeEm: Infinity })).toEqual([]);
  });

  it('samples each edge of a self-crossing contour on its own side', () => {
    // A bow-tie: its lobes are wound opposite ways, so the inside swaps sides along it.
    const corners: [number, number][] = [
      [0, 0],
      [2, 2],
      [0, 2],
      [2, 0],
    ];
    const contour = corners.map(([x0, y0], index) => {
      const [x1, y1] = corners[(index + 1) % corners.length] ?? [x0, y0];
      return { kind: 'line' as const, x0, y0, x1, y1 };
    });
    // Split where it crosses itself at (1, 1): the lower lobe is wound clockwise
    // (inside on the right), the upper counter-clockwise (inside on the left).
    expect(glyphEdges({ contours: [contour] }).map((edge) => edge.inside)).toEqual([
      -1, 1, 1, 1, -1, -1,
    ]);
  });

  it('keeps only the boundary of overlapping contours, joined at their crossings', () => {
    // Two squares overlapping in a unit square, as Roboto draws a g's bowl over its stem: each
    // has an edge inside the other, which the union's boundary leaves out.
    const square = (x: number, y: number) =>
      (
        [
          [x, y],
          [x + 2, y],
          [x + 2, y + 2],
          [x, y + 2],
        ] as const
      ).map(([x0, y0], index, corners) => {
        const [x1, y1] = corners[(index + 1) % corners.length] ?? [x0, y0];
        return { kind: 'line' as const, x0, y0, x1, y1 };
      });
    const edges = glyphEdges({ contours: [square(0, 0), square(1, 1)] });
    const lines = edges.flatMap((edge) => (edge.kind === 'line' ? [edge] : []));
    expect(lines).toHaveLength(edges.length);
    // The union's boundary: 2 + 1 + 1 + 1 + 2 + 1 + 1 + 1 = 12 along eight lines.
    const length = lines.reduce(
      (sum, { from, to }) => sum + Math.hypot(to[0] - from[0], to[1] - from[1]),
      0,
    );
    expect(length).toBeCloseTo(12, 12);
    expect(lines).toHaveLength(8);
    // Nothing of either square's edges inside the other is kept.
    for (const { from, to } of lines) {
      const [mx, my] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      expect(mx > 1 && mx < 2 && my > 1 && my < 2).toBe(false);
    }
    // The crossings at (2, 1) and (1, 2) are shared end to end: every end starts another edge.
    const starts = new Set(lines.map(({ from }) => from.join()));
    for (const { to } of lines) expect(starts.has(to.join())).toBe(true);
  });

  it('counts a curve whose end is a rounding error from the ray (Noto Sans SC)', () => {
    // The left edge's middle, (0.523 + 0.587) / 2, rounds to just below 0.555, where the
    // right contour's quadratic starts: a root rounded onto that end must still cross it.
    const box = (x0: number, y0: number, x1: number, y1: number) => [
      { kind: 'line' as const, x0, y0, x1: x0, y1 },
      { kind: 'line' as const, x0, y0: y1, x1, y1 },
      { kind: 'line' as const, x0: x1, y0: y1, x1, y1: y0 },
      { kind: 'line' as const, x0: x1, y0, x1: x0, y1: y0 },
    ];
    const left = box(0.293, 0.523, 0.4, 0.587);
    const right = [
      {
        kind: 'quadratic' as const,
        x0: 0.748,
        y0: 0.555,
        cx: 0.747,
        cy: 0.437,
        x1: 0.7375,
        y1: 0.3405,
      },
      { kind: 'line' as const, x0: 0.7375, y0: 0.3405, x1: 0.9, y1: 0.3405 },
      { kind: 'line' as const, x0: 0.9, y0: 0.3405, x1: 0.9, y1: 0.555 },
      { kind: 'line' as const, x0: 0.9, y0: 0.555, x1: 0.748, y1: 0.555 },
    ];
    const alone = glyphEdges({ contours: [left] }).map((edge) => edge.inside);
    const sides = glyphEdges({ contours: [left, right] }).map((edge) => edge.inside);
    expect(sides.slice(0, alone.length)).toEqual(alone);
  });

  it('drops a quadratic collapsed to a point', () => {
    const outline = {
      contours: [[{ kind: 'quadratic' as const, x0: 1, y0: 1, cx: 1, cy: 1, x1: 1, y1: 1 }]],
    };
    expect(glyphEdges(outline)).toEqual([]);
  });
});

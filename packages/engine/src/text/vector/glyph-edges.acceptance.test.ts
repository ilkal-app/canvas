/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as engine from '@canvas/engine';
import { loadShaper, type GlyphOutline, type OutlineSegment } from '@canvas/text';

type Point = readonly [number, number];
type Edge =
  | { kind: 'line'; from: Point; to: Point; inside: 1 | -1 }
  | { kind: 'quadratic'; start: Point; control: Point; end: Point; inside: 1 | -1 };
type Edges = (
  outline: GlyphOutline,
  options?: { toleranceEm?: number; maxBulgeEm?: number },
) => Edge[];

function glyphEdges(
  outline: GlyphOutline,
  options?: { toleranceEm?: number; maxBulgeEm?: number },
): Edge[] {
  const exported: unknown = Reflect.get(engine, 'glyphEdges');
  expect(exported, 'glyphEdges must be exported by @canvas/engine').toBeTypeOf('function');
  return (exported as Edges)(outline, options);
}

function square(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  isReversed = false,
): OutlineSegment[] {
  const corners: Point[] = isReversed
    ? [
        [x0, y0],
        [x0, y1],
        [x1, y1],
        [x1, y0],
      ]
    : [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ];
  return corners.map((point, index) => {
    const next = corners[(index + 1) % corners.length] ?? point;
    return { kind: 'line', x0: point[0], y0: point[1], x1: next[0], y1: next[1] };
  });
}

function quadraticRing(): GlyphOutline {
  const outer: Point[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  const inner: Point[] = [
    [0.4, 0],
    [0, -0.4],
    [-0.4, 0],
    [0, 0.4],
  ];
  const contour = (points: Point[], radius: number): OutlineSegment[] =>
    points.map((point, index) => {
      const next = points[(index + 1) % points.length] ?? point;
      const sx = Math.sign(point[0] + next[0]);
      const sy = Math.sign(point[1] + next[1]);
      return {
        kind: 'quadratic',
        x0: point[0],
        y0: point[1],
        cx: sx * radius,
        cy: sy * radius,
        x1: next[0],
        y1: next[1],
      };
    });
  return { contours: [contour(outer, 1), contour(inner, 0.4)] };
}

function point(segment: OutlineSegment, t: number): Point {
  const s = 1 - t;
  if (segment.kind === 'line')
    return [s * segment.x0 + t * segment.x1, s * segment.y0 + t * segment.y1];
  if (segment.kind === 'quadratic')
    return [
      s * s * segment.x0 + 2 * s * t * segment.cx + t * t * segment.x1,
      s * s * segment.y0 + 2 * s * t * segment.cy + t * t * segment.y1,
    ];
  return [
    s ** 3 * segment.x0 +
      3 * s * s * t * segment.c1x +
      3 * s * t * t * segment.c2x +
      t ** 3 * segment.x1,
    s ** 3 * segment.y0 +
      3 * s * s * t * segment.c1y +
      3 * s * t * t * segment.c2y +
      t ** 3 * segment.y1,
  ];
}

// Independent ray crossing over the original segments, flattened only for this test's oracle.
function contains(outline: GlyphOutline, p: Point): boolean {
  let winding = 0;
  for (const contour of outline.contours)
    for (const segment of contour) {
      const steps = segment.kind === 'line' ? 1 : 128;
      let a = point(segment, 0);
      for (let step = 1; step <= steps; step += 1) {
        const b = point(segment, step / steps);
        const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        if (a[1] <= p[1] && p[1] < b[1] && cross > 0) winding += 1;
        if (b[1] <= p[1] && p[1] < a[1] && cross < 0) winding -= 1;
        a = b;
      }
    }
  return winding !== 0;
}

function sampleSide(outline: GlyphOutline, edge: Edge): 1 | -1 | undefined {
  const [a, b] = edge.kind === 'line' ? [edge.from, edge.to] : [edge.start, edge.end];
  const mid: Point =
    edge.kind === 'line'
      ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      : [(a[0] + 2 * edge.control[0] + b[0]) / 4, (a[1] + 2 * edge.control[1] + b[1]) / 4];
  const tangent: Point =
    edge.kind === 'line' ? [b[0] - a[0], b[1] - a[1]] : [b[0] - a[0], b[1] - a[1]];
  const length = Math.hypot(...tangent);
  if (length < 1e-9) return undefined;
  const offset: Point = [(-tangent[1] / length) * 1e-5, (tangent[0] / length) * 1e-5];
  const isLeftInside = contains(outline, [mid[0] + offset[0], mid[1] + offset[1]]);
  const isRightInside = contains(outline, [mid[0] - offset[0], mid[1] - offset[1]]);
  return isLeftInside === isRightInside ? undefined : isLeftInside ? 1 : -1;
}

function bulge(edge: Edge): number {
  if (edge.kind === 'line') return 0;
  const { start: a, control: c, end: b } = edge;
  return (
    Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) /
    Math.hypot(b[0] - a[0], b[1] - a[1])
  );
}

describe('glyphEdges acceptance', () => {
  it('marks every edge of a square with the same inside side', () => {
    const outline = { contours: [square(0, 0, 1, 1)] };
    const edges = glyphEdges(outline);
    expect(edges).toHaveLength(4);
    expect(edges.map((edge) => edge.inside)).toEqual([1, 1, 1, 1]);
    expect(JSON.stringify(outline)).toBe(JSON.stringify({ contours: [square(0, 0, 1, 1)] }));
  });

  it.each([false, true])(
    'marks a hole wound against its outer square on the same side as it when reversed=%s',
    (isReversed) => {
      const outline = {
        contours: [square(0, 0, 1, 1, isReversed), square(0.25, 0.25, 0.75, 0.75, !isReversed)],
      };
      const edges = glyphEdges(outline);
      expect(edges).toHaveLength(8);
      expect(edges.slice(0, 4).map((edge) => edge.inside)).toEqual(
        Array(4).fill(isReversed ? -1 : 1),
      );
      // Corrected by Claude: wound the other way, the hole has the ring (the inside) on the same
      // side of travel as the outer square, as the sampling oracle below confirms.
      expect(edges.slice(4).map((edge) => edge.inside)).toEqual(Array(4).fill(isReversed ? -1 : 1));
      for (const edge of edges) expect(edge.inside).toBe(sampleSide(outline, edge));
    },
  );

  it('orients both quadratic contours of an o-like ring by filled side', () => {
    const outline = quadraticRing();
    const edges = glyphEdges(outline);
    expect(edges.some((edge) => edge.kind === 'quadratic')).toBe(true);
    for (const edge of edges) expect(edge.inside).toBe(sampleSide(outline, edge));
  });

  it('converts a cubic to quadratics within the requested bulge', () => {
    const outline: GlyphOutline = {
      contours: [
        [
          { kind: 'cubic', x0: 0, y0: 0, c1x: 0.15, c1y: -0.7, c2x: 0.85, c2y: 0.7, x1: 1, y1: 0 },
          ...square(0, 0, 1, 1).slice(1),
        ],
      ],
    };
    const edges = glyphEdges(outline, { toleranceEm: 1 / 8192, maxBulgeEm: 1 / 64 });
    expect(edges.some((edge) => edge.kind === 'quadratic')).toBe(true);
    expect(edges.every((edge) => bulge(edge) <= 1 / 64 + 1e-9)).toBe(true);
  });

  it('splits a high-bulge quadratic and never splits straight lines', () => {
    const outline: GlyphOutline = {
      contours: [
        [
          { kind: 'quadratic', x0: 0, y0: 0, cx: 0.5, cy: -0.5, x1: 1, y1: 0 },
          ...square(0, 0, 1, 1).slice(1),
        ],
      ],
    };
    const edges = glyphEdges(outline, { maxBulgeEm: 1 / 64 });
    expect(edges.filter((edge) => edge.kind === 'quadratic').length).toBeGreaterThan(1);
    expect(edges.filter((edge) => edge.kind === 'line')).toHaveLength(3);
    expect(edges.every((edge) => bulge(edge) <= 1 / 64 + 1e-9)).toBe(true);
  });

  it('drops zero-length edges', () => {
    const outline: GlyphOutline = {
      contours: [
        [
          { kind: 'line', x0: 0, y0: 0, x1: 0, y1: 0 },
          { kind: 'quadratic', x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0 },
          { kind: 'cubic', x0: 0, y0: 0, c1x: 0, c1y: 0, c2x: 0, c2y: 0, x1: 0, y1: 0 },
          ...square(0, 0, 1, 1),
        ],
      ],
    };
    expect(glyphEdges(outline)).toHaveLength(4);
  });

  it('agrees with independently sampled non-zero winding on bundled TrueType and CFF glyphs', async () => {
    const shaper = await loadShaper();
    const corpus = new URL('../../../../text/src/__fixtures__/format-corpus/', import.meta.url);
    for (const file of ['corpus-sans-regular.ttf', 'corpus-sans-regular.cff.otf']) {
      const face = shaper.face(file, Uint8Array.from(readFileSync(new URL(file, corpus))));
      let checked = 0;
      for (let id = 1; id < 40; id += 1) {
        const outline = shaper.outline(face, id);
        for (const edge of glyphEdges(outline)) {
          const side = sampleSide(outline, edge);
          if (side !== undefined) {
            expect(edge.inside).toBe(side);
            checked += 1;
          }
        }
      }
      expect(checked).toBeGreaterThan(50);
    }
  }, 30_000);
});

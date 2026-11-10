/// <reference types="node" />
// Acceptance: each test below pins one part of the pure glyph geometry contract.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadShaper, type GlyphOutline, type OutlineSegment } from '@canvas/text';

import {
  DEFAULT_CUBIC_TOLERANCE_EM,
  GlyphGeometryCache,
  tessellateGlyph,
  type GlyphGeometry,
} from './glyph-geometry.js';

interface Point {
  readonly x: number;
  readonly y: number;
}
interface Edge {
  readonly a: Point;
  readonly b: Point;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly dx: number;
  readonly dy: number;
}
interface Triangle {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly cx: number;
  readonly cy: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly area: number;
  readonly au: number;
  readonly av: number;
  readonly bu: number;
  readonly bv: number;
  readonly cu: number;
  readonly cv: number;
}
const EDGE_MARGIN = 0.001;

function square(x0: number, y0: number, x1: number, y1: number, isReversed = false) {
  const points = isReversed
    ? [
        { x: x0, y: y0 },
        { x: x0, y: y1 },
        { x: x1, y: y1 },
        { x: x1, y: y0 },
      ]
    : [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ];
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    if (next === undefined) throw new Error('missing square corner');
    return { kind: 'line' as const, x0: point.x, y0: point.y, x1: next.x, y1: next.y };
  });
}

function curvePoint(segment: OutlineSegment, t: number): Point {
  const s = 1 - t;
  if (segment.kind === 'line') {
    return { x: s * segment.x0 + t * segment.x1, y: s * segment.y0 + t * segment.y1 };
  }
  if (segment.kind === 'quadratic') {
    return {
      x: s * s * segment.x0 + 2 * s * t * segment.cx + t * t * segment.x1,
      y: s * s * segment.y0 + 2 * s * t * segment.cy + t * t * segment.y1,
    };
  }
  return {
    x:
      s * s * s * segment.x0 +
      3 * s * s * t * segment.c1x +
      3 * s * t * t * segment.c2x +
      t * t * t * segment.x1,
    y:
      s * s * s * segment.y0 +
      3 * s * s * t * segment.c1y +
      3 * s * t * t * segment.c2y +
      t * t * t * segment.y1,
  };
}

// Reference uses original curves, never the tessellator's quadratic approximation.
function referenceEdges(outline: GlyphOutline): Edge[] {
  const edges: Edge[] = [];
  for (const contour of outline.contours) {
    for (const segment of contour) {
      const steps = segment.kind === 'line' ? 1 : 256;
      let a = curvePoint(segment, 0);
      for (let index = 1; index <= steps; index += 1) {
        const b = curvePoint(segment, index / steps);
        edges.push({
          a,
          b,
          minX: Math.min(a.x, b.x),
          minY: Math.min(a.y, b.y),
          maxX: Math.max(a.x, b.x),
          maxY: Math.max(a.y, b.y),
          dx: b.x - a.x,
          dy: b.y - a.y,
        });
        a = b;
      }
    }
  }
  return edges;
}

function distanceToEdge(point: Point, edge: Edge): number {
  const length = edge.dx * edge.dx + edge.dy * edge.dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - edge.a.x) * edge.dx + (point.y - edge.a.y) * edge.dy) / length),
        );
  return Math.hypot(point.x - edge.a.x - t * edge.dx, point.y - edge.a.y - t * edge.dy);
}

function winding(point: Point, edges: readonly Edge[], margin: number): number | undefined {
  let count = 0;
  for (const edge of edges) {
    if (
      point.x >= edge.minX - margin &&
      point.x <= edge.maxX + margin &&
      point.y >= edge.minY - margin &&
      point.y <= edge.maxY + margin &&
      distanceToEdge(point, edge) < margin
    )
      return undefined;
    if (point.y < edge.minY || point.y >= edge.maxY || point.x > edge.maxX) continue;
    const cross = edge.dx * (point.y - edge.a.y) - edge.dy * (point.x - edge.a.x);
    if (edge.a.y <= point.y && point.y < edge.b.y && cross > 0) count += 1;
    if (edge.b.y <= point.y && point.y < edge.a.y && cross < 0) count -= 1;
  }
  return count;
}

function stencilTriangles(geometry: GlyphGeometry): Triangle[] {
  const data = geometry.vertices;
  const triangles: Triangle[] = [];
  for (let offset = 0; offset < data.length; offset += 12) {
    const ax = data[offset] ?? 0;
    const ay = data[offset + 1] ?? 0;
    const bx = data[offset + 4] ?? 0;
    const by = data[offset + 5] ?? 0;
    const cx = data[offset + 8] ?? 0;
    const cy = data[offset + 9] ?? 0;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    triangles.push({
      ax,
      ay,
      bx,
      by,
      cx,
      cy,
      minX: Math.min(ax, bx, cx),
      minY: Math.min(ay, by, cy),
      maxX: Math.max(ax, bx, cx),
      maxY: Math.max(ay, by, cy),
      area,
      au: data[offset + 2] ?? 0,
      av: data[offset + 3] ?? 0,
      bu: data[offset + 6] ?? 0,
      bv: data[offset + 7] ?? 0,
      cu: data[offset + 10] ?? 0,
      cv: data[offset + 11] ?? 0,
    });
  }
  return triangles;
}

// Barycentric interpolation reproduces the curve stencil's u,v test in em coordinates.
function stencilCount(point: Point, triangles: readonly Triangle[]): number {
  let count = 0;
  for (const triangle of triangles) {
    // The barycentric test below admits a tiny area beyond each side.
    const xSlack = 2e-8 * (triangle.maxX - triangle.minX);
    const ySlack = 2e-8 * (triangle.maxY - triangle.minY);
    if (
      point.x < triangle.minX - xSlack ||
      point.x > triangle.maxX + xSlack ||
      point.y < triangle.minY - ySlack ||
      point.y > triangle.maxY + ySlack
    )
      continue;
    const b =
      ((point.x - triangle.ax) * (triangle.cy - triangle.ay) -
        (point.y - triangle.ay) * (triangle.cx - triangle.ax)) /
      triangle.area;
    const c =
      ((triangle.bx - triangle.ax) * (point.y - triangle.ay) -
        (triangle.by - triangle.ay) * (point.x - triangle.ax)) /
      triangle.area;
    const a = 1 - b - c;
    if (a < -1e-8 || b < -1e-8 || c < -1e-8) continue;
    const u = a * triangle.au + b * triangle.bu + c * triangle.cu;
    const v = a * triangle.av + b * triangle.bv + c * triangle.cv;
    if (u * u - v < 0) count += Math.sign(triangle.area);
  }
  return count;
}

function compareGrid(outline: GlyphOutline, size: number, margin = EDGE_MARGIN): void {
  const geometry = tessellateGlyph(outline);
  const edges = referenceEdges(outline);
  const triangles = stencilTriangles(geometry);
  const bounds = geometry.bounds;
  expect(bounds).toBeDefined();
  if (bounds === undefined) throw new Error('missing glyph bounds');
  let checked = 0;
  for (let row = 0; row < size; row += 1) {
    const y = bounds.minY + ((row + 0.43) / size) * (bounds.maxY - bounds.minY);
    const rowEdges = edges.filter((edge) => y >= edge.minY - margin && y <= edge.maxY + margin);
    const rowTriangles = triangles.filter((triangle) => {
      const slack = 2e-8 * (triangle.maxY - triangle.minY);
      return y >= triangle.minY - slack && y <= triangle.maxY + slack;
    });
    for (let column = 0; column < size; column += 1) {
      const point = {
        x: bounds.minX + ((column + 0.37) / size) * (bounds.maxX - bounds.minX),
        y,
      };
      const expected = winding(point, rowEdges, margin);
      if (expected === undefined) continue;
      expect(stencilCount(point, rowTriangles), `at ${String(point.x)}, ${String(point.y)}`).toBe(
        expected,
      );
      checked += 1;
    }
  }
  expect(checked).toBeGreaterThan(size);
  expect(geometry.vertexCount).toBe(geometry.vertices.length / 4);
  expect(geometry.vertexCount % 3).toBe(0);
}

const convexAndConcave: GlyphOutline = {
  contours: [
    [
      { kind: 'quadratic', x0: 0, y0: 0, cx: 0.5, cy: -0.25, x1: 1, y1: 0 },
      { kind: 'line', x0: 1, y0: 0, x1: 1, y1: 1 },
      { kind: 'quadratic', x0: 1, y0: 1, cx: 0.5, cy: 0.75, x1: 0, y1: 1 },
      { kind: 'line', x0: 0, y0: 1, x1: 0, y1: 0 },
    ],
  ],
};
const cubicOutline: GlyphOutline = {
  contours: [
    [
      { kind: 'cubic', x0: 0, y0: 0, c1x: 0.1, c1y: -0.8, c2x: 0.9, c2y: 0.8, x1: 1, y1: 0 },
      { kind: 'line', x0: 1, y0: 0, x1: 1, y1: 1 },
      { kind: 'line', x0: 1, y0: 1, x1: 0, y1: 1 },
      { kind: 'line', x0: 0, y0: 1, x1: 0, y1: 0 },
    ],
  ],
};

describe('glyph geometry acceptance', () => {
  // Pins signed non-zero winding, holes, overlap count 2, and both curve kinds.
  it.each([
    ['square', { contours: [square(0, 0, 1, 1)] }],
    ['hole', { contours: [square(0, 0, 1, 1), square(0.25, 0.25, 0.75, 0.75, true)] }],
    ['overlap', { contours: [square(0, 0, 1, 1), square(0.4, 0, 1.4, 1)] }],
    ['quadratics', convexAndConcave],
    ['cubic', cubicOutline],
  ] as const)('%s has the reference winding across a grid', (name, outline) => {
    expect(name.length).toBeGreaterThan(0);
    compareGrid(outline, 40);
  });

  // Pins exact packed layout, fan coordinates, control triangle coordinates, and immutability.
  it('emits fan and quadratic corners without changing the outline', () => {
    const before = JSON.stringify(convexAndConcave);
    const geometry = tessellateGlyph(convexAndConcave);
    expect(JSON.stringify(convexAndConcave)).toBe(before);
    expect(geometry.vertices).toBeInstanceOf(Float32Array);
    const corners: number[][] = [];
    for (let index = 0; index < geometry.vertexCount; index += 1) {
      corners.push(Array.from(geometry.vertices.slice(index * 4, index * 4 + 4)));
    }
    expect(corners).toContainEqual([0, 0, 0, 0]);
    expect(corners).toContainEqual([0.5, -0.25, 0.5, 0]);
    expect(corners).toContainEqual([1, 0, 1, 1]);
    expect(corners).toContainEqual([0, 0, 0, 1]);
    expect(corners.every((corner) => corner.length === 4)).toBe(true);
    expect(geometry.vertexCount % 3).toBe(0);
  });

  // Pins line bounds in em and empty-outline behavior.
  it('returns precise square bounds and no geometry for an empty outline', () => {
    expect(tessellateGlyph({ contours: [square(-2, -1, 3, 4)] }).bounds).toEqual({
      minX: -2,
      minY: -1,
      maxX: 3,
      maxY: 4,
    });
    const empty = tessellateGlyph({ contours: [] });
    expect(empty.vertexCount).toBe(0);
    expect(empty.vertices).toHaveLength(0);
    expect(empty.bounds).toBeUndefined();
  });

  // Pins a useful tolerance tradeoff and edge accuracy against the original cubic.
  it('uses fewer vertices at coarse cubic tolerance and agrees away from the true edge', () => {
    expect(DEFAULT_CUBIC_TOLERANCE_EM).toBe(1 / 4096);
    const coarse = tessellateGlyph(cubicOutline, 1 / 64);
    const fine = tessellateGlyph(cubicOutline);
    expect(coarse.vertexCount).toBeLessThan(fine.vertexCount);
    expect(fine.vertexCount).toBeLessThanOrEqual(400);
    compareGrid(cubicOutline, 64, 2 / 4096);
  });

  // Pins byte accounting, get recency, eviction, replacement, and oversized newest retention.
  it('evicts the least recently used entry by vertex bytes', () => {
    const cache = new GlyphGeometryCache(96);
    const a = tessellateGlyph({ contours: [square(0, 0, 1, 1)] });
    const small = { vertices: new Float32Array(12), vertexCount: 3, bounds: undefined };
    cache.set('a', small);
    cache.set('b', small);
    expect(cache.bytes).toBe(96);
    expect(cache.get('a')).toBe(small);
    cache.set('c', small);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(small);
    expect(cache.bytes).toBe(96);
    cache.set('a', a);
    expect(cache.get('a')).toBe(a);
    expect(cache.get('c')).toBeUndefined();
    const huge = { vertices: new Float32Array(48), vertexCount: 12, bounds: undefined };
    cache.set('huge', huge);
    expect(cache.get('huge')).toBe(huge);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.bytes).toBe(huge.vertices.byteLength);
  });
});

// Pins HarfBuzz's real TrueType and CFF contours, including original cubic reference edges.
describe('HarfBuzz corpus glyph geometry', () => {
  const corpus = new URL('../../../../text/src/__fixtures__/format-corpus/', import.meta.url);
  for (const file of ['corpus-sans-regular.ttf', 'corpus-sans-regular.cff.otf']) {
    it(`${file}: 20 nonempty glyphs agree on a 64×64 grid`, async () => {
      const shaper = await loadShaper();
      const face = shaper.face(file, Uint8Array.from(readFileSync(new URL(file, corpus))));
      let tested = 0;
      let cubic = 0;
      for (let glyphId = 1; glyphId < 100 && tested < 20; glyphId += 1) {
        const outline = shaper.outline(face, glyphId);
        if (outline.contours.length === 0) continue;
        if (outline.contours.some((contour) => contour.some((segment) => segment.kind === 'cubic')))
          cubic += 1;
        compareGrid(outline, 64);
        tested += 1;
      }
      expect(tested).toBe(20);
      if (file.endsWith('.cff.otf')) expect(cubic).toBeGreaterThan(0);
    }, 30_000);
  }
});

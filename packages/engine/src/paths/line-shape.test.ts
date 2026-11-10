import { describe, expect, it } from 'vitest';

import { covers, meshBounds } from './__fixtures__/mesh-coverage.js';
import { capLength } from './caps.js';
import { elbowRoute } from './elbow-route.js';
import { lineShapeOf, writeLineShape } from './line-shape.js';
import { TriangleWriter } from './triangle-writer.js';

const ROUTE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
] as const;

describe('lineShapeOf', () => {
  it('strokes a plain line end to end with round ends and no heads', () => {
    expect(lineShapeOf({ route: ROUTE, startCap: 'none', endCap: 'none' }, 2)).toEqual({
      shaft: ROUTE,
      shaftCaps: { start: 'round', end: 'round' },
      heads: [],
    });
  });

  it('pulls the shaft back under a triangle and points the head along the last piece', () => {
    const shape = lineShapeOf({ route: ROUTE, startCap: 'none', endCap: 'triangle' }, 2);
    expect(shape.shaft.at(-1)).toEqual({ x: 100 - capLength(2) / 2, y: 0 });
    expect(shape.shaftCaps.end).toBe('butt');
    expect(shape.heads).toHaveLength(1);
    expect(shape.heads[0]?.kind === 'polygon' && shape.heads[0].points[0]).toEqual({
      x: 100,
      y: 0,
    });
  });

  it('points a start head back out of the line', () => {
    const shape = lineShapeOf({ route: ROUTE, startCap: 'triangle', endCap: 'none' }, 2);
    const head = shape.heads[0];
    // The base lies to the right of the start point: the head points left, out of the line.
    expect(head?.kind === 'polygon' && head.points[1]?.x).toBeCloseTo(capLength(2), 9);
  });

  it('points an elbow line’s heads along its first and last pieces', () => {
    const route = elbowRoute({ x: 0, y: 0 }, { x: 100, y: 40 });
    const shape = lineShapeOf({ route, startCap: 'arrow', endCap: 'arrow' }, 2);
    const [start, end] = shape.heads;
    expect(start?.kind === 'stroke' && start.points[1]).toEqual({ x: 0, y: 0 });
    // Both barbs of the end arrow lie left of its tip: it arrives horizontally.
    expect(end?.kind === 'stroke' && end.points.every(({ x }) => x <= 100)).toBe(true);
  });

  it('pulls a short last piece back no further than its start', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 2, y: 50 },
    ];
    const shape = lineShapeOf({ route, startCap: 'none', endCap: 'triangle' }, 4);
    expect(shape.shaft.at(-1)).toEqual({ x: 0, y: 50 });
  });

  it('keeps each head of a short line to its own half, never past the far end', () => {
    // 20 long at width 6: a full head would be 26 long, longer than the whole line.
    const route = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ];
    for (const cap of ['arrow', 'triangle', 'diamond', 'circle'] as const) {
      const shape = lineShapeOf({ route, startCap: cap, endCap: cap }, 6);
      const [start, end] = shape.heads;
      const extentOf = (head: typeof start) => {
        if (!head) return [];
        if (head.kind === 'disc') return [head.centre.x - head.radius, head.centre.x + head.radius];
        return head.points.map(({ x }) => x);
      };
      // The start head reaches at most to the middle going in, and so does the end head.
      expect(Math.max(...extentOf(start))).toBeLessThanOrEqual(10 + 1e-9);
      expect(Math.min(...extentOf(end))).toBeGreaterThanOrEqual(10 - 1e-9);
    }
    const triangles = lineShapeOf({ route, startCap: 'triangle', endCap: 'triangle' }, 6);
    expect(triangles.shaft).toEqual([
      { x: 5, y: 0 },
      { x: 15, y: 0 },
    ]);
  });

  it('has no heads when every point coincides', () => {
    const route = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(lineShapeOf({ route, startCap: 'arrow', endCap: 'circle' }, 2).heads).toEqual([]);
  });
});

describe('writeLineShape', () => {
  it('draws the shaft and the heads, and nothing past a triangle’s point', () => {
    const writer = new TriangleWriter();
    writeLineShape(writer, { route: ROUTE, startCap: 'circle', endCap: 'triangle' }, 2, 0.05);
    const mesh = writer.toFloat32Array();
    expect(covers(mesh, 50, 0)).toBe(true);
    expect(covers(mesh, 99, 0)).toBe(true);
    expect(covers(mesh, 100.5, 0)).toBe(false);
    expect(covers(mesh, -2, 0)).toBe(true);
  });

  it('draws a line whose ends coincide as a round dot the size of its stroke, whatever its caps', () => {
    const route = [
      { x: 40, y: 30 },
      { x: 40, y: 30 },
    ];
    for (const cap of ['none', 'arrow', 'triangle', 'circle', 'diamond'] as const) {
      const shape = lineShapeOf({ route, startCap: cap, endCap: cap }, 6);
      expect(shape.shaftCaps).toEqual({ start: 'round', end: 'round' });
      const writer = new TriangleWriter();
      writeLineShape(writer, { route, startCap: cap, endCap: cap }, 6, 0.05);
      const mesh = writer.toFloat32Array();
      expect(covers(mesh, 40, 30)).toBe(true);
      expect(covers(mesh, 42.5, 30)).toBe(true);
      const bounds = meshBounds(mesh);
      expect(bounds.minX).toBeCloseTo(37, 6);
      expect(bounds.maxX).toBeCloseTo(43, 6);
      expect(bounds.maxY).toBeCloseTo(33, 6);
    }
  });
});

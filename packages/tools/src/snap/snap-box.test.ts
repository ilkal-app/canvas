import { describe, expect, it } from 'vitest';

import type { WorldBounds } from '@canvas/engine';

import { guidesOf, snapBox } from './snap-box.js';
import { snapThresholdAt } from './snap-threshold.js';

function bounds(x: number, y: number, width: number, height: number): WorldBounds {
  return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

/** A 100 × 100 neighbour at the origin. */
const NEIGHBOUR = bounds(0, 0, 100, 100);

describe('snapBox', () => {
  it('snaps the left edge to a neighbour’s right edge with a guide across both', () => {
    const { delta, guides } = snapBox(bounds(104, 200, 50, 50), [NEIGHBOUR], 6);
    expect(delta).toEqual({ x: -4, y: 0 });
    expect(guides).toEqual([{ axis: 'x', position: 100, from: 0, to: 250 }]);
  });

  it('snaps each edge and the centre to each edge and the centre, the nearest winning', () => {
    // A 30-wide box: its left edge, centre and right edge are x, x + 15 and x + 30; the
    // neighbour's lines are 0, 50 and 100.
    const cases: [number, number][] = [
      [3, -3],
      [52, -2],
      [97, 3],
      [-11, -4],
      [34, 1],
      [86, -1],
      [-28, -2],
      [17, 3],
      [72, -2],
    ];
    for (const [x, expected] of cases) {
      const { delta } = snapBox(bounds(x, 300, 30, 10), [NEIGHBOUR], 6);
      expect(delta.x, `x = ${String(x)}`).toBe(expected);
    }
  });

  it('snaps both axes at once, each with its own guide', () => {
    const { delta, guides } = snapBox(bounds(102, 103, 20, 20), [NEIGHBOUR], 6);
    expect(delta).toEqual({ x: -2, y: -3 });
    expect(guides).toContainEqual({ axis: 'x', position: 100, from: 0, to: 120 });
    expect(guides).toContainEqual({ axis: 'y', position: 100, from: 0, to: 120 });
  });

  it('leaves a box further than the threshold where it is', () => {
    const result = snapBox(bounds(107, 300, 10, 10), [NEIGHBOUR], 6);
    expect(result).toEqual({ delta: { x: 0, y: 0 }, guides: [] });
  });

  it('snaps at exactly the threshold, and shows a guide for a box already aligned', () => {
    expect(snapBox(bounds(106, 300, 10, 10), [NEIGHBOUR], 6).delta.x).toBe(-6);
    const aligned = snapBox(bounds(100, 300, 10, 10), [NEIGHBOUR], 6);
    expect(aligned.delta.x).toBe(0);
    expect(aligned.guides).toEqual([{ axis: 'x', position: 100, from: 0, to: 310 }]);
  });

  it('measures the threshold in screen pixels: 6 px is 24 world units at 25% and 1.5 at 400%', () => {
    const far = bounds(120, 300, 10, 10);
    expect(snapBox(far, [NEIGHBOUR], snapThresholdAt(0.25)).delta.x).toBe(-20);
    expect(snapBox(far, [NEIGHBOUR], snapThresholdAt(4)).delta.x).toBe(0);
    expect(snapBox(bounds(101.5, 300, 10, 10), [NEIGHBOUR], snapThresholdAt(4)).delta.x).toBe(-1.5);
    expect(snapBox(bounds(101.6, 300, 10, 10), [NEIGHBOUR], snapThresholdAt(4)).delta.x).toBe(0);
  });

  it('spans a guide over every candidate on the line and the box', () => {
    const above = bounds(0, -300, 100, 50);
    const { guides } = snapBox(bounds(102, 400, 10, 10), [NEIGHBOUR, above], 6);
    expect(guides).toEqual([{ axis: 'x', position: 100, from: -300, to: 410 }]);
  });

  it('snaps to the grid when no object is in reach, and prefers an object when one is', () => {
    const grid = { spacing: 16 };
    // x: both edges are 3 from a line (32, 48), the first wins; y: 260 → 256 beats 250 → 256.
    expect(snapBox(bounds(35, 250, 10, 10), [], 6, grid).delta).toEqual({ x: -3, y: -4 });
    // The grid line at 112 is 1 from the right edge, the neighbour's edge 3 from the left: the
    // object wins.
    const preferred = snapBox(bounds(103, 250, 10, 10), [NEIGHBOUR], 6, grid);
    expect(preferred.delta.x).toBe(-3);
    expect(preferred.guides.map((guide) => guide.axis)).toEqual(['x']);
  });

  it('draws no guide for a grid snap and snaps edges, not the centre, to it', () => {
    const { delta, guides } = snapBox(bounds(20, 20, 10, 10), [], 6, { spacing: 16 });
    // Edges 20 and 30: 20 → 16 is 4, 30 → 32 is 2; the centre 25 is not a source.
    expect(delta).toEqual({ x: 2, y: 2 });
    expect(guides).toEqual([]);
  });

  it('snaps only the edges it is given, for a resize', () => {
    const box = bounds(200, 300, 10, 10);
    const right = snapBox(box, [bounds(214, 0, 10, 10)], 6, undefined, { x: ['max'], y: [] });
    expect(right.delta).toEqual({ x: 4, y: 0 });
    const left = snapBox(box, [bounds(214, 0, 10, 10)], 6, undefined, { x: ['min'], y: [] });
    expect(left.delta).toEqual({ x: 0, y: 0 });
  });

  it('does not change its inputs', () => {
    const box = Object.freeze(bounds(104, 200, 50, 50));
    const candidates = Object.freeze([Object.freeze({ ...NEIGHBOUR })]);
    expect(() => snapBox(box, candidates, 6, Object.freeze({ spacing: 16 }))).not.toThrow();
  });
});

describe('guidesOf', () => {
  it('finds the lines a box’s given edges lie on, and nothing off them', () => {
    const box = bounds(100, 200, 50, 50);
    expect(guidesOf(box, [NEIGHBOUR], { x: ['min'], y: [] })).toEqual([
      { axis: 'x', position: 100, from: 0, to: 250 },
    ]);
    expect(guidesOf(box, [NEIGHBOUR], { x: ['max'], y: ['min', 'max'] })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { snapPoint } from './snap-point.js';

const NEIGHBOUR = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

describe('snapPoint', () => {
  it('snaps a point to a neighbour’s edge and centre lines, with guides from the point', () => {
    const { point, guides } = snapPoint({ x: 103, y: 48 }, [NEIGHBOUR], 6);
    expect(point).toEqual({ x: 100, y: 50 });
    expect(guides).toEqual([
      { axis: 'x', position: 100, from: 0, to: 100 },
      { axis: 'y', position: 50, from: 0, to: 100 },
    ]);
  });

  it('snaps to the grid when nothing is in reach', () => {
    expect(snapPoint({ x: 250, y: 301 }, [NEIGHBOUR], 6, { spacing: 16 }).point).toEqual({
      x: 256,
      y: 304,
    });
  });

  it('leaves a point far from everything where it is', () => {
    expect(snapPoint({ x: 250, y: 301 }, [NEIGHBOUR], 6)).toEqual({
      point: { x: 250, y: 301 },
      guides: [],
    });
  });
});

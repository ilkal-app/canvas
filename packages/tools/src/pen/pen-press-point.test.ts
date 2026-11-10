import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import { testPath } from './__fixtures__/pen-mode-context.js';
import { penPressPoint, snapPenWorld, type PenSnapping } from './pen-press-point.js';

const toLocal = (world: Point): Point => ({ x: world.x - 100, y: world.y - 100 });

/** A snapper that puts every point on the nearest multiple of 10, with one guide. */
const TENS: PenSnapping = {
  snap: (world) => ({
    point: { x: Math.round(world.x / 10) * 10, y: Math.round(world.y / 10) * 10 },
    guides: [{ axis: 'x', position: 0, from: 0, to: 1 } as never],
  }),
  settings: { isEnabled: true, isGridVisible: false },
  zoom: 1,
  excludedIds: new Set(),
};

describe('penPressPoint', () => {
  it('snaps a point that places a new vertex, but not one on the path', () => {
    const path = testPath();
    const free = penPressPoint(path, { x: 153, y: 187 }, toLocal, undefined, false, TENS);
    expect(free.point).toEqual({ x: 50, y: 90 });
    expect(free.guides).toHaveLength(1);
    const onVertex = penPressPoint(path, { x: 203, y: 101 }, toLocal, undefined, false, TENS);
    expect(onVertex).toEqual({ point: { x: 103, y: 1 }, guides: [] });
  });

  it('keeps Shift on 45° steps from the chain’s vertex, unsnapped', () => {
    const path = testPath();
    const from = path.vertices[2];
    const shifted = penPressPoint(path, { x: 400, y: 104 }, toLocal, from, true, TENS);
    expect(shifted.point.y).toBeCloseTo(0, 9);
    expect(shifted.guides).toEqual([]);
  });

  it('leaves points alone while snapping is off', () => {
    const off = { ...TENS, settings: { isEnabled: false, isGridVisible: false } };
    expect(snapPenWorld({ x: 3, y: 4 }, off)).toEqual({ point: { x: 3, y: 4 }, guides: [] });
    expect(snapPenWorld({ x: 3, y: 4 }, { ...TENS, snap: undefined }).point).toEqual({
      x: 3,
      y: 4,
    });
  });
});

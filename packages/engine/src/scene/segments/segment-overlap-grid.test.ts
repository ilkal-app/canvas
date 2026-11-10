import { describe, expect, it } from 'vitest';

import { SegmentOverlapGrid } from './segment-overlap-grid.js';

/**
 * A box from its left, top, width and height.
 *
 * @param x - Left, world units.
 * @param y - Top.
 * @param width - Width.
 * @param height - Height.
 * @returns The box.
 */
function box(x: number, y: number, width = 10, height = 10) {
  return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

const EXTENT = box(0, 0, 1000, 1000);

describe('SegmentOverlapGrid', () => {
  it('finds an object of a later pass that a box meets, and nothing it does not meet', () => {
    const grid = new SegmentOverlapGrid(EXTENT, 100);
    grid.add(box(100, 100), 3);
    expect(grid.hasLaterOverlap(box(105, 105), 1)).toBe(true);
    // Touching edges count: the grid errs towards a split.
    expect(grid.hasLaterOverlap(box(110, 100), 1)).toBe(true);
    expect(grid.hasLaterOverlap(box(500, 500), 1)).toBe(false);
  });

  it('ignores objects that draw no later than the queried pass', () => {
    const grid = new SegmentOverlapGrid(EXTENT, 100);
    grid.add(box(100, 100), 1);
    grid.add(box(300, 300), 0);
    expect(grid.hasLaterOverlap(box(100, 100), 1)).toBe(false);
    expect(grid.hasLaterOverlap(box(100, 100), 0)).toBe(true);
    expect(grid.hasLaterOverlap(box(300, 300), 0)).toBe(false);
  });

  it('forgets everything on clear, reusing its cells for the next segment', () => {
    const grid = new SegmentOverlapGrid(EXTENT, 100);
    grid.add(box(100, 100), 3);
    expect(grid.hasLaterOverlap(box(100, 100), 1)).toBe(true);
    grid.clear();
    expect(grid.hasLaterOverlap(box(100, 100), 1)).toBe(false);
    grid.add(box(102, 102), 3);
    expect(grid.hasLaterOverlap(box(100, 100), 1)).toBe(true);
  });

  it('checks a box over many cells from every query, and boxes past the extent at its edge', () => {
    const grid = new SegmentOverlapGrid(EXTENT, 100);
    grid.add(box(0, 0, 900, 900), 2);
    grid.add(box(-50, 1200), 2);
    expect(grid.hasLaterOverlap(box(450, 450), 1)).toBe(true);
    expect(grid.hasLaterOverlap(box(-45, 1205), 1)).toBe(true);
    expect(grid.hasLaterOverlap(box(950, 10), 1)).toBe(false);
    grid.clear();
    expect(grid.hasLaterOverlap(box(450, 450), 1)).toBe(false);
  });

  it('treats an object without a box as meeting everything', () => {
    const grid = new SegmentOverlapGrid(EXTENT, 100);
    grid.add(undefined, 3);
    expect(grid.hasLaterOverlap(box(900, 900), 1)).toBe(true);
    expect(grid.hasLaterOverlap(box(900, 900), 3)).toBe(false);
    grid.clear();
    grid.add(box(10, 10), 3);
    expect(grid.hasLaterOverlap(undefined, 1)).toBe(true);
    expect(grid.hasLaterOverlap(undefined, 3)).toBe(false);
    grid.clear();
    grid.add(box(0, 0, 900, 900), 3);
    expect(grid.hasLaterOverlap(undefined, 1)).toBe(true);
  });

  it('works with no extent, or one of a single point', () => {
    const empty = new SegmentOverlapGrid(undefined, 0);
    empty.add(box(5, 5), 2);
    expect(empty.hasLaterOverlap(box(6, 6), 1)).toBe(true);
    const point = new SegmentOverlapGrid(box(7, 7, 0, 0), 1);
    point.add(box(7, 7, 0, 0), 2);
    expect(point.hasLaterOverlap(box(7, 7, 0, 0), 1)).toBe(true);
  });
});

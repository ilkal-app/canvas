import { describe, expect, it } from 'vitest';

import { dashIntervals, MAX_DASHES } from './stroke-dash.js';

// Where a dash pattern's dashes fall along a stroke, as SVG's stroke-dasharray and
// stroke-dashoffset place them.

describe('dashIntervals', () => {
  it('repeats the pattern along the stroke and clips the last dash at its end', () => {
    expect(dashIntervals(25, { pattern: [6, 4], offset: 0 })).toEqual([
      [0, 6],
      [10, 16],
      [20, 25],
    ]);
  });

  it('repeats an odd pattern to make it even, as SVG does', () => {
    expect(dashIntervals(20, { pattern: [5], offset: 0 })).toEqual([
      [0, 5],
      [10, 15],
    ]);
    expect(dashIntervals(18, { pattern: [2, 1, 3], offset: 0 })).toEqual([
      [0, 2],
      [3, 6],
      [8, 9],
      [12, 14],
      [15, 18],
    ]);
  });

  it('starts the pattern offset into itself, either way, modulo its period', () => {
    expect(dashIntervals(20, { pattern: [6, 4], offset: 3 })).toEqual([
      [0, 3],
      [7, 13],
      [17, 20],
    ]);
    // −7 is 3 modulo the period of 10, and 23 too.
    expect(dashIntervals(20, { pattern: [6, 4], offset: -7 })).toEqual(
      dashIntervals(20, { pattern: [6, 4], offset: 3 }),
    );
    expect(dashIntervals(20, { pattern: [6, 4], offset: 23 })).toEqual(
      dashIntervals(20, { pattern: [6, 4], offset: 3 }),
    );
    // Into the gap: the stroke starts with a gap.
    expect(dashIntervals(12, { pattern: [6, 4], offset: 8 })).toEqual([[2, 8]]);
  });

  it('keeps dashes of length 0 as points, at the stroke’s ends too', () => {
    expect(dashIntervals(6, { pattern: [0, 3], offset: 0 })).toEqual([
      [0, 0],
      [3, 3],
      [6, 6],
    ]);
    expect(dashIntervals(5, { pattern: [0, 3], offset: 1 })).toEqual([
      [2, 2],
      [5, 5],
    ]);
  });

  it('draws one clipped dash where the pattern is longer than the stroke', () => {
    expect(dashIntervals(4, { pattern: [100, 50], offset: 0 })).toEqual([[0, 4]]);
    expect(dashIntervals(4, { pattern: [100, 50], offset: 120 })).toEqual([]);
  });

  it('draws solid (undefined) for a pattern of no length or with too many dashes', () => {
    expect(dashIntervals(10, { pattern: [0, 0], offset: 0 })).toBeUndefined();
    expect(dashIntervals(10, { pattern: [Number.NaN, 1], offset: 0 })).toBeUndefined();
    expect(dashIntervals(10, { pattern: [1, 1], offset: Number.NaN })).toBeUndefined();
    expect(dashIntervals(MAX_DASHES * 2 + 10, { pattern: [1, 1], offset: 0 })).toBeUndefined();
    expect(dashIntervals(MAX_DASHES, { pattern: [1, 1], offset: 0 })).toHaveLength(MAX_DASHES / 2);
  });

  it('does not mutate the pattern', () => {
    const dash = { pattern: [3], offset: 1 };
    dashIntervals(30, dash);
    expect(dash).toEqual({ pattern: [3], offset: 1 });
  });
});

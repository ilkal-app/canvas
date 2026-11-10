import { describe, expect, it } from 'vitest';

import {
  colourAt,
  cssColour,
  MAX_PERIODS,
  paramRange,
  periodsNeeded,
  REPEAT_PERIODS,
  stopsOver,
} from './colour-stops.js';

const black = { r: 0, g: 0, b: 0, a: 1 };
const white = { r: 1, g: 1, b: 1, a: 1 };
const line = [
  { offset: 0.25, color: black, isForeground: false },
  { offset: 0.75, color: white, isForeground: false },
] as const;

describe('cssColour', () => {
  it('clamps each channel and rounds to bytes', () => {
    expect(cssColour({ r: 2, g: -1, b: 0.5, a: 1.5 })).toBe('rgba(255, 0, 128, 1)');
  });
});

describe('colourAt', () => {
  it('interpolates inside the stops and pads past them', () => {
    expect(colourAt(line, 'pad', 0.5).r).toBeCloseTo(0.5);
    expect(colourAt(line, 'pad', 0)).toEqual(black);
    expect(colourAt(line, 'pad', 1)).toEqual(white);
  });

  it('repeats and reflects by period', () => {
    expect(colourAt(line, 'repeat', 0.875).r).toBeCloseTo(0.25);
    expect(colourAt(line, 'reflect', 0.875).r).toBeCloseTo(0.75);
    expect(colourAt(line, 'reflect', 0).r).toBeCloseTo(0.5);
  });

  it('takes the later colour at coincident stops, and transparent with no stops', () => {
    const hard = [
      { offset: 0.5, color: black, isForeground: false },
      { offset: 0.5, color: white, isForeground: false },
    ];
    expect(colourAt(hard, 'repeat', 0.5)).toEqual(black);
    expect(colourAt([], 'pad', 0.5)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});

describe('stopsOver', () => {
  it('writes the ends and every stop inside a padding range', () => {
    expect(stopsOver(line, 'pad', 0, 1).map((stop) => stop.t)).toEqual([0, 0.25, 0.75, 1]);
  });

  it('tiles repeating stops with a hard edge where two periods meet', () => {
    const tiled = stopsOver(line, 'repeat', 0, 1.25);
    expect(tiled.map((stop) => stop.t)).toEqual([0, 0.25, 0.25, 0.75, 0.75, 1.25]);
    expect(tiled.map((stop) => stop.color.r)).toEqual([0.5, 1, 0, 1, 0, 0]);
  });

  it('writes only the ends of a line with no stops', () => {
    expect(stopsOver([], 'repeat', 0, 1).map((stop) => stop.t)).toEqual([0, 1]);
  });

  it('tiles mirrored stops across the range', () => {
    const mirrored = stopsOver(line, 'reflect', -0.25, 0.25);
    expect(mirrored.map((stop) => stop.t)).toEqual([-0.25, 0.25]);
    expect(mirrored[0]?.color).toEqual(white);
  });
});

describe('paramRange', () => {
  it('widens a padding line to take stops outside 0..1', () => {
    expect(paramRange(line, 'pad')).toEqual([0, 1]);
    const wide = [
      { offset: -0.5, color: black, isForeground: false },
      { offset: 1.5, color: white, isForeground: false },
    ];
    expect(paramRange(wide, 'pad')).toEqual([-0.5, 1.5]);
  });

  it('widens a repeating line by whole periods on each side', () => {
    const span = 0.5 * REPEAT_PERIODS;
    expect(paramRange(line, 'reflect')).toEqual([0.25 - span, 0.75 + span]);
  });

  it('widens a repeating line by whole periods to the parameters needed, one more, capped', () => {
    expect(paramRange(line, 'repeat', [0, 2])).toEqual([-0.75, 2.75]);
    const [from, to] = paramRange(line, 'repeat', [-1e9, 1e9]);
    expect([from, to]).toEqual([0.25 - 0.5 * MAX_PERIODS, 0.75 + 0.5 * MAX_PERIODS]);
    expect(paramRange(line, 'reflect', [0.5, 0.5])).toEqual([-0.25, 1.25]);
  });

  it('counts the periods a range needs on its farther side, one more', () => {
    expect(periodsNeeded(line, [0, 2])).toBe(4);
    expect(periodsNeeded(line, [0.5, 0.5])).toBe(1);
    expect(periodsNeeded([line[0]], [0, 100])).toBe(0);
    expect(periodsNeeded([], [-1, 1])).toBe(2);
  });

  it('gives 0..1 for a degenerate or empty line', () => {
    expect(paramRange([line[0]], 'repeat')).toEqual([0, 1]);
    expect(paramRange([], 'pad')).toEqual([0, 1]);
  });
});

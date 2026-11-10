import { describe, expect, it } from 'vitest';

import {
  EMPTY_TRACE_TINT,
  isTraceTintModel,
  TRACE_TINT_FILL_ALPHA,
  traceTintRectsOf,
  type TraceTintModel,
} from './trace-tint-model.js';

const AGENT = [0.6, 0.7, 0.8, 1] as const;
const MODEL: TraceTintModel = {
  sheets: [{ bounds: { minX: 100, minY: 200, maxX: 300, maxY: 260 }, color: [...AGENT] }],
};

describe('traceTintRectsOf', () => {
  it('draws nothing for no sheet', () => {
    expect(traceTintRectsOf(EMPTY_TRACE_TINT, 1)).toEqual([]);
  });

  it('pads the bounds by screen sizes, room for the tab above, and fills at a low alpha', () => {
    const [fill, top, bottom, left, right] = traceTintRectsOf(MODEL, 1, 2);
    expect(fill).toEqual({
      x: 84,
      y: 144,
      width: 232,
      height: 132,
      color: [0.6, 0.7, 0.8, TRACE_TINT_FILL_ALPHA],
    });
    expect(top).toEqual({ x: 84, y: 144, width: 232, height: 1.5, color: [...AGENT] });
    expect(bottom).toEqual({ x: 84, y: 274.5, width: 232, height: 1.5, color: [...AGENT] });
    expect(left).toEqual({ x: 84, y: 145.5, width: 1.5, height: 129, color: [...AGENT] });
    expect(right).toEqual({ x: 314.5, y: 145.5, width: 1.5, height: 129, color: [...AGENT] });
  });

  it('keeps the padding and outline the same on screen at another zoom', () => {
    const [fill, top] = traceTintRectsOf(MODEL, 4, 2);
    expect(fill).toMatchObject({ x: 96, y: 186, width: 208, height: 78 });
    expect(top?.height).toBe(0.375);
  });

  it('rounds the outline to whole device pixels, at least one', () => {
    expect(traceTintRectsOf(MODEL, 1)[1]?.height).toBe(2);
    expect(traceTintRectsOf(MODEL, 2, 1)[1]?.height).toBe(1);
    expect(traceTintRectsOf(MODEL, 1, 3)[1]?.height).toBeCloseTo(5 / 3);
    expect(traceTintRectsOf(MODEL, 1, 0.5)[1]?.height).toBe(2);
  });

  it('draws five rectangles per sheet, sheet by sheet', () => {
    const two = { sheets: [...MODEL.sheets, ...MODEL.sheets] };
    expect(traceTintRectsOf(two, 1)).toHaveLength(10);
  });
});

describe('isTraceTintModel', () => {
  it('accepts well-formed sheets and refuses anything else', () => {
    expect(isTraceTintModel(MODEL)).toBe(true);
    expect(isTraceTintModel(EMPTY_TRACE_TINT)).toBe(true);
    expect(isTraceTintModel(undefined)).toBe(false);
    expect(isTraceTintModel({ sheets: 'no' })).toBe(false);
    const sheet = MODEL.sheets[0];
    expect(isTraceTintModel({ sheets: [{ ...sheet, color: [1, 1, 1] }] })).toBe(false);
    expect(
      isTraceTintModel({
        sheets: [{ ...sheet, bounds: { minX: Number.NaN, minY: 0, maxX: 1, maxY: 1 } }],
      }),
    ).toBe(false);
    expect(
      isTraceTintModel({ sheets: [{ ...sheet, bounds: { minX: 2, minY: 0, maxX: 1, maxY: 1 } }] }),
    ).toBe(false);
  });
});

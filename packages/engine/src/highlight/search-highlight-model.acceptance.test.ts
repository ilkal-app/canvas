import { describe, expect, it } from 'vitest';

import {
  EMPTY_SEARCH_HIGHLIGHT,
  isSearchHighlightModel,
  searchHighlightRectsOf,
  type SearchHighlightModel,
} from './search-highlight-model.js';

const COLOR = [0.6, 0.7, 0.8, 0.5] as const;
const MODEL: SearchHighlightModel = {
  color: COLOR,
  boxes: [{ bounds: { minX: 100, minY: 200, maxX: 300, maxY: 260 }, isActive: false }],
};

describe('isSearchHighlightModel', () => {
  it('accepts an empty model and finite, ordered boxes with a four-channel colour', () => {
    expect(isSearchHighlightModel(EMPTY_SEARCH_HIGHLIGHT)).toBe(true);
    expect(isSearchHighlightModel(MODEL)).toBe(true);
    expect(isSearchHighlightModel(undefined)).toBe(false);
    expect(isSearchHighlightModel({ ...MODEL, boxes: 'no' })).toBe(false);
    expect(isSearchHighlightModel({ ...MODEL, color: [1, 1, 1] })).toBe(false);
    expect(isSearchHighlightModel({ ...MODEL, color: [1, 1, Infinity, 1] })).toBe(false);
    expect(
      isSearchHighlightModel({ ...MODEL, boxes: [{ ...MODEL.boxes[0], isActive: 'yes' }] }),
    ).toBe(false);
    for (const bounds of [
      { minX: NaN, minY: 0, maxX: 1, maxY: 1 },
      { minX: 2, minY: 0, maxX: 1, maxY: 1 },
      { minX: 0, minY: 2, maxX: 1, maxY: 1 },
    ]) {
      expect(isSearchHighlightModel({ ...MODEL, boxes: [{ bounds, isActive: false }] })).toBe(
        false,
      );
    }
  });
});

describe('searchHighlightRectsOf', () => {
  it('draws nothing for no boxes', () => {
    expect(searchHighlightRectsOf(EMPTY_SEARCH_HIGHLIGHT, 1)).toEqual([]);
  });

  it('pads all four sides by four screen pixels and draws four non-overlapping edges', () => {
    expect(searchHighlightRectsOf(MODEL, 1)).toEqual([
      { x: 96, y: 196, width: 208, height: 2, color: COLOR },
      { x: 96, y: 262, width: 208, height: 2, color: COLOR },
      { x: 96, y: 198, width: 2, height: 64, color: COLOR },
      { x: 302, y: 198, width: 2, height: 64, color: COLOR },
    ]);
  });

  it('keeps padding and line width in screen pixels at zoom two and DPR two', () => {
    expect(searchHighlightRectsOf(MODEL, 2, 2)).toEqual([
      { x: 98, y: 198, width: 204, height: 0.75, color: COLOR },
      { x: 98, y: 261.25, width: 204, height: 0.75, color: COLOR },
      { x: 98, y: 198.75, width: 0.75, height: 62.5, color: COLOR },
      { x: 301.25, y: 198.75, width: 0.75, height: 62.5, color: COLOR },
    ]);
    expect(searchHighlightRectsOf(MODEL, 1, 2)[0]?.height).toBe(1.5);
  });

  it('puts an eight percent fill before the active box’s thicker outline', () => {
    const box = MODEL.boxes[0];
    if (box === undefined) throw new Error('The fixture has no box');
    const active = { ...MODEL, boxes: [{ ...box, isActive: true }] };
    const [fill, top, bottom, left, right] = searchHighlightRectsOf(active, 1, 2);
    expect(fill).toEqual({ x: 96, y: 196, width: 208, height: 68, color: [0.6, 0.7, 0.8, 0.04] });
    expect(top).toEqual({ x: 96, y: 196, width: 208, height: 2.5, color: COLOR });
    expect(bottom).toEqual({ x: 96, y: 261.5, width: 208, height: 2.5, color: COLOR });
    expect(left).toEqual({ x: 96, y: 198.5, width: 2.5, height: 63, color: COLOR });
    expect(right).toEqual({ x: 301.5, y: 198.5, width: 2.5, height: 63, color: COLOR });
  });
});

import { describe, expect, it } from 'vitest';

import {
  ATTRIBUTE_BASE_STYLE,
  copyTextStyle,
  isStoredTextStyle,
  styleFromAttributes,
  stylePatchToAttributes,
  styleToAttributes,
} from './style-attributes.js';

const COORDINATES = { wght: 650, wdth: 87.5 };

describe('font variation Y.Text attribute', () => {
  it('stores all coordinates in one copied attribute and round trips them', () => {
    const style = { ...ATTRIBUTE_BASE_STYLE, fontVariations: COORDINATES };
    const attributes = styleToAttributes(style);
    expect(attributes).toEqual({ fontVariations: COORDINATES });
    expect(attributes.fontVariations).not.toBe(COORDINATES);
    expect(styleFromAttributes(attributes)).toEqual(style);
    expect(copyTextStyle(style).fontVariations).toEqual(COORDINATES);
    expect(copyTextStyle(style).fontVariations).not.toBe(COORDINATES);
  });

  it('never stores an empty map and clears coordinates with null', () => {
    expect(styleToAttributes(ATTRIBUTE_BASE_STYLE)).toEqual({});
    expect(styleToAttributes({ ...ATTRIBUTE_BASE_STYLE, fontVariations: {} })).toEqual({});
    expect(stylePatchToAttributes({ fontVariations: COORDINATES })).toEqual({
      fontVariations: COORDINATES,
    });
    expect(stylePatchToAttributes({ fontVariations: {} })).toEqual({ fontVariations: null });
    expect(stylePatchToAttributes({ fontVariations: null })).toEqual({ fontVariations: null });
  });

  it('reads malformed attributes as none and rejects malformed stored styles', () => {
    for (const fontVariations of [
      'wght=650',
      [],
      { wgh: 650 },
      { wght: Infinity },
      { wght: -32769 },
      Object.fromEntries(
        Array.from({ length: 17 }, (unused, index) => [
          `a${String(index).padStart(3, '0')}`,
          index,
        ]),
      ),
    ]) {
      expect(styleFromAttributes({ fontVariations })).toEqual(ATTRIBUTE_BASE_STYLE);
      expect(isStoredTextStyle({ ...ATTRIBUTE_BASE_STYLE, fontVariations })).toBe(false);
    }
    expect(isStoredTextStyle({ ...ATTRIBUTE_BASE_STYLE, fontVariations: COORDINATES })).toBe(true);
  });
});

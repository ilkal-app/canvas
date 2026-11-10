import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';

import {
  ATTRIBUTE_BASE_STYLE,
  copyTextStyle,
  isStoredTextStyle,
  styleFromAttributes,
  stylePatchToAttributes,
  styleToAttributes,
} from './style-attributes.js';

const ink = { ...ATTRIBUTE_BASE_STYLE, color: 'ink' } as unknown as TextStyle;

describe('ink text storage', () => {
  it('keeps old unformatted text black', () => {
    expect(ATTRIBUTE_BASE_STYLE.color).toEqual([0, 0, 0, 1]);
    expect(styleFromAttributes(undefined).color).toEqual([0, 0, 0, 1]);
    expect(styleToAttributes(ATTRIBUTE_BASE_STYLE)).toEqual({});
  });
  it('stores the token as one attribute, never a character array', () => {
    expect(styleToAttributes(ink)).toEqual({ color: 'ink' });
    expect(stylePatchToAttributes({ color: ink.color })).toEqual({ color: 'ink' });
    expect(copyTextStyle(ink)).toEqual(ink);
    expect(styleFromAttributes({ color: 'ink' })).toEqual(ink);
    expect(isStoredTextStyle(ink)).toBe(true);
  });
  it.each(['Ink', 'white', [NaN, 0, 0, 1], [2, 0, 0, 1], ['i', 'n', 'k']])(
    'reads invalid attributes tolerantly without changing the base: %j',
    (color) => {
      expect(styleFromAttributes({ color }).color).toEqual([0, 0, 0, 1]);
      expect(ATTRIBUTE_BASE_STYLE.color).toEqual([0, 0, 0, 1]);
    },
  );
});

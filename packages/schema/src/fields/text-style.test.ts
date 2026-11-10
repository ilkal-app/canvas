import { describe, expect, it } from 'vitest';

import {
  isSameTextStyle,
  letterSpacingSchema,
  lineHeightSchema,
  textStyleSchema,
  type TextStyle,
} from './text-style.js';

const STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

describe('letter-spacing and line-height', () => {
  it('are optional, so a style without them stays valid and keeps its five keys', () => {
    const parsed = textStyleSchema.parse(STYLE);
    expect(Object.keys(parsed).sort()).toEqual(
      ['color', 'fontFamily', 'fontSize', 'italic', 'weight'].sort(),
    );
  });

  it('accept px or percent of the font size, and auto for line-height', () => {
    const tracked = {
      ...STYLE,
      letterSpacing: { value: 12, unit: 'percent' },
      lineHeight: { value: 24, unit: 'px' },
    } as const;
    expect(textStyleSchema.parse(tracked)).toEqual(tracked);
    expect(lineHeightSchema.parse('auto')).toBe('auto');
    expect(lineHeightSchema.parse({ value: 150, unit: 'percent' })).toEqual({
      value: 150,
      unit: 'percent',
    });
    expect(letterSpacingSchema.parse({ value: -2, unit: 'px' })).toEqual({ value: -2, unit: 'px' });
  });

  it('refuse values out of range, unknown units and extra keys', () => {
    for (const letterSpacing of [
      { value: 401, unit: 'px' },
      { value: -401, unit: 'px' },
      { value: 401, unit: 'percent' },
      { value: -101, unit: 'percent' },
      { value: Number.NaN, unit: 'px' },
      { value: 1, unit: 'em' },
      { value: 1 },
      { value: 1, unit: 'px', extra: true },
    ]) {
      expect(
        letterSpacingSchema.safeParse(letterSpacing).success,
        JSON.stringify(letterSpacing),
      ).toBe(false);
    }
    for (const lineHeight of [
      { value: 0, unit: 'px' },
      { value: -1, unit: 'percent' },
      { value: 4001, unit: 'px' },
      { value: 1001, unit: 'percent' },
      'normal',
      1.5,
    ]) {
      expect(lineHeightSchema.safeParse(lineHeight).success, JSON.stringify(lineHeight)).toBe(
        false,
      );
    }
  });

  it('compare by value, a zero spacing and an auto line-height the same as none', () => {
    expect(isSameTextStyle({ ...STYLE, letterSpacing: { value: 0, unit: 'px' } }, STYLE)).toBe(
      true,
    );
    expect(isSameTextStyle({ ...STYLE, letterSpacing: { value: 0, unit: 'percent' } }, STYLE)).toBe(
      true,
    );
    expect(isSameTextStyle({ ...STYLE, lineHeight: 'auto' }, STYLE)).toBe(true);
    expect(
      isSameTextStyle(
        { ...STYLE, letterSpacing: { value: 2, unit: 'px' } },
        { ...STYLE, letterSpacing: { value: 2, unit: 'px' } },
      ),
    ).toBe(true);
    expect(
      isSameTextStyle(
        { ...STYLE, letterSpacing: { value: 2, unit: 'px' } },
        { ...STYLE, letterSpacing: { value: 2, unit: 'percent' } },
      ),
    ).toBe(false);
    expect(isSameTextStyle({ ...STYLE, letterSpacing: { value: 1, unit: 'px' } }, STYLE)).toBe(
      false,
    );
    expect(
      isSameTextStyle(
        { ...STYLE, lineHeight: { value: 20, unit: 'px' } },
        { ...STYLE, lineHeight: { value: 20, unit: 'px' } },
      ),
    ).toBe(true);
    expect(isSameTextStyle({ ...STYLE, lineHeight: { value: 125, unit: 'percent' } }, STYLE)).toBe(
      false,
    );
  });
});

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

const BODY: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0.1, 0.1, 0.1, 1],
  weight: 400,
  italic: false,
};

describe('style attributes', () => {
  it('round-trips a style through its attributes', () => {
    expect(styleFromAttributes(styleToAttributes(BODY))).toEqual(BODY);
    const everyField: TextStyle = {
      fontFamily: 'Georgia',
      fontSize: 40,
      color: [1, 0, 0, 1],
      weight: 700,
      italic: true,
    };
    expect(styleFromAttributes(styleToAttributes(everyField))).toEqual(everyField);
  });

  it('carries only the fields that differ from the base style', () => {
    expect(styleToAttributes(ATTRIBUTE_BASE_STYLE)).toEqual({});
    expect(styleToAttributes(BODY)).toEqual({ fontSize: 24, color: [0.1, 0.1, 0.1, 1] });
    expect(styleToAttributes({ ...ATTRIBUTE_BASE_STYLE, weight: 700 })).toEqual({ weight: 700 });
  });

  it('removes the attribute when a restyle sets a field to its base value', () => {
    expect(stylePatchToAttributes({ weight: 400, italic: true })).toEqual({
      weight: null,
      italic: true,
    });
    expect(stylePatchToAttributes({ color: [0, 0, 0, 1] })).toEqual({ color: null });
    expect(stylePatchToAttributes({})).toEqual({});
  });

  it('copies the colour, so the attribute never aliases the caller’s array', () => {
    const attributes = styleToAttributes(BODY);
    expect(attributes.color).not.toBe(BODY.color);
    const patch = stylePatchToAttributes({ color: BODY.color, weight: 700 });
    expect(patch).toEqual({ color: BODY.color, weight: 700 });
    expect(patch.color).not.toBe(BODY.color);
    expect(copyTextStyle(BODY)).toEqual(BODY);
    expect(copyTextStyle(BODY).color).not.toBe(BODY.color);
  });

  it('takes each missing or malformed attribute from the base style', () => {
    const bold = { ...ATTRIBUTE_BASE_STYLE, weight: 700 } as const;
    expect(styleFromAttributes({ weight: 700 })).toEqual(bold);
    expect(
      styleFromAttributes({
        fontFamily: 3,
        fontSize: 'big',
        color: [1, 2],
        weight: 450,
        italic: 'yes',
      }),
    ).toEqual(ATTRIBUTE_BASE_STYLE);
    expect(styleFromAttributes(undefined)).toBe(ATTRIBUTE_BASE_STYLE);
  });

  it('stores letter-spacing and line-height only when set, and reads them back', () => {
    const tracked: TextStyle = {
      ...BODY,
      letterSpacing: { value: 12, unit: 'percent' },
      lineHeight: { value: 30, unit: 'px' },
    };
    expect(styleToAttributes(tracked)).toEqual({
      fontSize: 24,
      color: [0.1, 0.1, 0.1, 1],
      letterSpacing: { value: 12, unit: 'percent' },
      lineHeight: { value: 30, unit: 'px' },
    });
    expect(styleFromAttributes(styleToAttributes(tracked))).toEqual(tracked);
    expect(styleToAttributes({ ...BODY, letterSpacing: { value: 0, unit: 'px' } })).toEqual(
      styleToAttributes(BODY),
    );
    expect(styleToAttributes({ ...BODY, lineHeight: 'auto' })).toEqual(styleToAttributes(BODY));
    expect(stylePatchToAttributes({ letterSpacing: { value: 0, unit: 'px' } })).toEqual({
      letterSpacing: null,
    });
    expect(stylePatchToAttributes({ lineHeight: 'auto' })).toEqual({ lineHeight: null });
    expect(stylePatchToAttributes({ lineHeight: { value: 150, unit: 'percent' } })).toEqual({
      lineHeight: { value: 150, unit: 'percent' },
    });
  });

  it('copies the spacing objects, so no attribute aliases the caller’s', () => {
    const letterSpacing = { value: 2, unit: 'px' } as const;
    const lineHeight = { value: 20, unit: 'px' } as const;
    const style: TextStyle = { ...BODY, letterSpacing, lineHeight };
    const attributes = styleToAttributes(style);
    expect(attributes.letterSpacing).not.toBe(letterSpacing);
    expect(attributes.lineHeight).not.toBe(lineHeight);
    expect(stylePatchToAttributes({ letterSpacing }).letterSpacing).not.toBe(letterSpacing);
    const copy = copyTextStyle(style);
    expect(copy).toEqual(style);
    expect(copy.letterSpacing).not.toBe(letterSpacing);
    expect(copy.lineHeight).not.toBe(lineHeight);
  });

  it('reads a malformed letter-spacing or line-height as none', () => {
    for (const letterSpacing of [
      3,
      'tight',
      { value: 1, unit: 'em' },
      { value: 'x', unit: 'px' },
    ]) {
      expect(styleFromAttributes({ letterSpacing }), JSON.stringify(letterSpacing)).toEqual(
        ATTRIBUTE_BASE_STYLE,
      );
    }
    for (const lineHeight of [
      'normal',
      1.5,
      { value: 1, unit: 'em' },
      { value: null, unit: 'px' },
    ]) {
      expect(styleFromAttributes({ lineHeight }), JSON.stringify(lineHeight)).toEqual(
        ATTRIBUTE_BASE_STYLE,
      );
    }
    expect(styleFromAttributes({ lineHeight: 'auto' })).toEqual(ATTRIBUTE_BASE_STYLE);
  });

  it('accepts a stored style with or without the spacing fields', () => {
    expect(isStoredTextStyle({ ...BODY, letterSpacing: { value: 1, unit: 'px' } })).toBe(true);
    expect(isStoredTextStyle({ ...BODY, lineHeight: 'auto' })).toBe(true);
    expect(isStoredTextStyle({ ...BODY, lineHeight: { value: 120, unit: 'percent' } })).toBe(true);
    expect(isStoredTextStyle({ ...BODY, letterSpacing: { value: 1, unit: 'em' } })).toBe(false);
    expect(isStoredTextStyle({ ...BODY, lineHeight: 'normal' })).toBe(false);
  });

  it('keeps the base style frozen, since it is part of the stored format', () => {
    expect(Object.isFrozen(ATTRIBUTE_BASE_STYLE)).toBe(true);
    expect(Object.isFrozen(ATTRIBUTE_BASE_STYLE.color)).toBe(true);
    expect(isStoredTextStyle(ATTRIBUTE_BASE_STYLE)).toBe(true);
    expect(isStoredTextStyle({ ...BODY, weight: 450 })).toBe(false);
    expect(isStoredTextStyle({ ...BODY, weight: 500 })).toBe(true);
    expect(isStoredTextStyle(null)).toBe(false);
  });
});

describe('variable-font coordinates', () => {
  it('read empty stored coordinates as none, as they are never written', () => {
    expect(styleFromAttributes({ fontVariations: {} })).toEqual(ATTRIBUTE_BASE_STYLE);
  });
});

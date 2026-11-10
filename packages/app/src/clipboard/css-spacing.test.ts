import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';

import {
  cssLetterSpacing,
  cssLineHeight,
  declaredLetterSpacing,
  declaredLineHeight,
} from './css-spacing.js';

const STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

describe('letter-spacing and line-height as CSS', () => {
  it('writes px as px, percent spacing in em, percent line-height as %', () => {
    expect(cssLetterSpacing(STYLE)).toBeUndefined();
    expect(cssLetterSpacing({ ...STYLE, letterSpacing: { value: 0, unit: 'px' } })).toBeUndefined();
    expect(cssLetterSpacing({ ...STYLE, letterSpacing: { value: 2, unit: 'px' } })).toBe('2px');
    expect(cssLetterSpacing({ ...STYLE, letterSpacing: { value: 12, unit: 'percent' } })).toBe(
      '0.12em',
    );
    expect(cssLineHeight(STYLE)).toBeUndefined();
    expect(cssLineHeight({ ...STYLE, lineHeight: 'auto' })).toBeUndefined();
    expect(cssLineHeight({ ...STYLE, lineHeight: { value: 24, unit: 'px' } })).toBe('24px');
    expect(cssLineHeight({ ...STYLE, lineHeight: { value: 150, unit: 'percent' } })).toBe('150%');
  });

  it('reads them back, normal as none and auto, a unitless line-height as a percent', () => {
    expect(declaredLetterSpacing('2px')).toEqual({ value: 2, unit: 'px' });
    expect(declaredLetterSpacing('0.12em')).toEqual({ value: 12, unit: 'percent' });
    expect(declaredLetterSpacing('-0.5px')).toEqual({ value: -0.5, unit: 'px' });
    expect(declaredLetterSpacing('normal')).toBeNull();
    expect(declaredLineHeight('24px')).toEqual({ value: 24, unit: 'px' });
    expect(declaredLineHeight('150%')).toEqual({ value: 150, unit: 'percent' });
    expect(declaredLineHeight('1.4')).toEqual({ value: 140, unit: 'percent' });
    expect(declaredLineHeight('normal')).toBe('auto');
  });

  it('ignores what it cannot read or the schema refuses', () => {
    for (const value of ['', 'wide', '2pt', '10%', '9999px']) {
      expect(declaredLetterSpacing(value), value).toBeUndefined();
    }
    for (const value of ['', 'tall', '2em', '0px', '-1', '99999px']) {
      expect(declaredLineHeight(value), value).toBeUndefined();
    }
  });
});

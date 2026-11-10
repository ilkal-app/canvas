import { describe, expect, it } from 'vitest';

import { NO_LETTER_SPACING } from '@canvas/tools';

import { MIXED } from '../controls/mixed-value.js';

import {
  convertSpacing,
  letterSpacingUnitPatch,
  letterSpacingValuePatch,
  lineHeightUnitPatch,
  lineHeightValuePatch,
  shownLetterSpacing,
  shownLineHeight,
} from './text-spacing.js';

const SIZE = { fontSize: 20 } as const;

describe('the style panel’s spacing fields', () => {
  it('converts px and percent of the font size, keeping the number without one size', () => {
    expect(convertSpacing(10, 'percent', 'px', 20)).toBe(2);
    expect(convertSpacing(3, 'px', 'percent', 20)).toBe(15);
    expect(convertSpacing(1, 'px', 'percent', 3)).toBe(33.33);
    expect(convertSpacing(7, 'px', 'percent', undefined)).toBe(7);
    expect(convertSpacing(7, 'px', 'px', 20)).toBe(7);
  });

  it('shows letter-spacing mixed, none as 0 %, or its value and unit', () => {
    expect(shownLetterSpacing({})).toMatchObject({ value: MIXED, unit: MIXED });
    expect(shownLetterSpacing({ letterSpacing: NO_LETTER_SPACING })).toEqual({
      value: 0,
      unit: 'percent',
      min: -100,
      max: 400,
    });
    expect(shownLetterSpacing({ letterSpacing: { value: 2, unit: 'px' } })).toEqual({
      value: 2,
      unit: 'px',
      min: -400,
      max: 400,
    });
  });

  it('shows line-height mixed, auto as 125, or its value and unit', () => {
    expect(shownLineHeight({})).toMatchObject({ value: MIXED, unit: MIXED });
    expect(shownLineHeight({ lineHeight: 'auto' })).toEqual({
      value: 125,
      unit: 'auto',
      min: 1,
      max: 1000,
    });
    expect(shownLineHeight({ lineHeight: { value: 24, unit: 'px' } })).toEqual({
      value: 24,
      unit: 'px',
      min: 1,
      max: 4000,
    });
  });

  it('sets a typed number in the field’s unit, percent while none, auto or mixed', () => {
    expect(letterSpacingValuePatch({ letterSpacing: NO_LETTER_SPACING }, 5)).toEqual({
      letterSpacing: { value: 5, unit: 'percent' },
    });
    expect(letterSpacingValuePatch({ letterSpacing: { value: 1, unit: 'px' } }, 3)).toEqual({
      letterSpacing: { value: 3, unit: 'px' },
    });
    expect(letterSpacingValuePatch({}, 4)).toEqual({
      letterSpacing: { value: 4, unit: 'percent' },
    });
    expect(lineHeightValuePatch({ lineHeight: 'auto' }, 150)).toEqual({
      lineHeight: { value: 150, unit: 'percent' },
    });
    expect(lineHeightValuePatch({ lineHeight: { value: 20, unit: 'px' } }, 28)).toEqual({
      lineHeight: { value: 28, unit: 'px' },
    });
  });

  it('converts the shown value when the unit changes, and sets auto', () => {
    expect(
      letterSpacingUnitPatch({ ...SIZE, letterSpacing: { value: 10, unit: 'percent' } }, 'px'),
    ).toEqual({ letterSpacing: { value: 2, unit: 'px' } });
    expect(letterSpacingUnitPatch({ ...SIZE, letterSpacing: NO_LETTER_SPACING }, 'px')).toEqual({
      letterSpacing: NO_LETTER_SPACING,
    });
    expect(letterSpacingUnitPatch({ ...SIZE }, 'px')).toBeUndefined();
    expect(lineHeightUnitPatch({ ...SIZE, lineHeight: 'auto' }, 'px')).toEqual({
      lineHeight: { value: 25, unit: 'px' },
    });
    expect(
      lineHeightUnitPatch({ ...SIZE, lineHeight: { value: 30, unit: 'px' } }, 'percent'),
    ).toEqual({ lineHeight: { value: 150, unit: 'percent' } });
    expect(lineHeightUnitPatch({ ...SIZE, lineHeight: { value: 30, unit: 'px' } }, 'auto')).toEqual(
      {
        lineHeight: 'auto',
      },
    );
    expect(lineHeightUnitPatch({ ...SIZE }, 'px')).toBeUndefined();
  });

  it('clamps a converted value to the unit’s range', () => {
    expect(
      letterSpacingUnitPatch(
        { fontSize: 400, letterSpacing: { value: 400, unit: 'percent' } },
        'px',
      ),
    ).toEqual({ letterSpacing: { value: 400, unit: 'px' } });
  });
});

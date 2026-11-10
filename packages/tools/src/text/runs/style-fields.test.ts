import { describe, expect, it } from 'vitest';

import { BASE } from './__fixtures__/text-styles.js';
import { isSameStyleField, NO_LETTER_SPACING, shownTextStyle } from './style-fields.js';

describe('style fields', () => {
  it('compares a field as the schema compares styles', () => {
    expect(isSameStyleField('color', [1, 0, 0, 1], [1, 0, 0, 1])).toBe(true);
    expect(isSameStyleField('color', [1, 0, 0, 1], 'ink')).toBe(false);
    expect(isSameStyleField('letterSpacing', undefined, { value: 0, unit: 'px' })).toBe(true);
    expect(
      isSameStyleField('letterSpacing', { value: 2, unit: 'px' }, { value: 2, unit: 'px' }),
    ).toBe(true);
    expect(
      isSameStyleField('letterSpacing', { value: 2, unit: 'px' }, { value: 2, unit: 'percent' }),
    ).toBe(false);
    expect(isSameStyleField('lineHeight', undefined, 'auto')).toBe(true);
    expect(isSameStyleField('lineHeight', 'auto', { value: 20, unit: 'px' })).toBe(false);
  });

  it('spells out no spacing, an auto line-height and no coordinates, keeping set values', () => {
    expect(shownTextStyle(BASE)).toEqual({
      ...BASE,
      letterSpacing: NO_LETTER_SPACING,
      lineHeight: 'auto',
      fontVariations: {},
    });
    const set = {
      ...BASE,
      letterSpacing: { value: 3, unit: 'px' },
      lineHeight: { value: 120, unit: 'percent' },
      fontVariations: { wght: 700 },
    } as const;
    expect(shownTextStyle(set)).toEqual(set);
    expect(shownTextStyle({ ...BASE, letterSpacing: { value: 0, unit: 'px' } }).letterSpacing).toBe(
      NO_LETTER_SPACING,
    );
  });
});

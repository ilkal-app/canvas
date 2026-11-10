import { describe, expect, it } from 'vitest';

import { drawableValuesReason } from './drawable-values.js';
import { labelPositionValueReason } from './label-position-values.js';

describe('labelPositionValueReason', () => {
  it('takes an absent position or a fraction from 0 to 1', () => {
    for (const value of [undefined, 0, 0.25, 1])
      expect(labelPositionValueReason(value)).toBeUndefined();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.01, 1.01])(
    'refuses %s as out of range',
    (value) => {
      expect(labelPositionValueReason(value)).toEqual({ field: '', reason: 'out-of-range' });
    },
  );

  it('refuses anything that is not a number, and the door judges a style group by it', () => {
    expect(labelPositionValueReason('0.5')).toEqual({ field: '', reason: 'not-a-number' });
    expect(drawableValuesReason('style', { labelPosition: 0.5 })).toBeUndefined();
    expect(drawableValuesReason('style', { labelPosition: 2 })).toMatchObject({
      reason: 'out-of-range',
    });
  });
});

import { describe, expect, it } from 'vitest';

import { instanceScaleReason } from './drawable-ranges.js';
import { drawableValuesReason } from './drawable-values.js';

describe("the door's judgement of an instance's content scale", () => {
  it('admits a size group whose scale is absent or from 0.05 to 20', () => {
    for (const scale of [undefined, 0.05, 1, 2.5, 20]) {
      const size = { width: 100, height: 50, ...(scale === undefined ? {} : { scale }) };
      expect(drawableValuesReason('size', size)).toBeUndefined();
    }
  });

  it('refuses a scale out of range, not finite or not a number', () => {
    for (const [scale, reason] of [
      [0, 'out-of-range'],
      [-1, 'out-of-range'],
      [0.049, 'out-of-range'],
      [20.5, 'out-of-range'],
      [Number.NaN, 'not-finite'],
      [Number.POSITIVE_INFINITY, 'not-finite'],
    ] as const) {
      expect(instanceScaleReason(scale)).toBe(reason);
      expect(drawableValuesReason('size', { width: 100, height: 50, scale })).toEqual({
        field: 'scale',
        reason,
      });
    }
    expect(drawableValuesReason('size', { width: 100, height: 50, scale: '2' })).toEqual({
      field: 'scale',
      reason: 'not-a-number',
    });
  });
});

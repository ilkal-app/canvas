import { describe, expect, it } from 'vitest';

import { drawableValuesReason } from './drawable-values.js';
import { frameCornerRadiusReason } from './frame-radius-values.js';

describe('the judgement of a frame radius', () => {
  it('accepts absent, one radius and four', () => {
    expect(frameCornerRadiusReason(undefined)).toBeUndefined();
    expect(frameCornerRadiusReason(0)).toBeUndefined();
    expect(frameCornerRadiusReason([0, 1, 2, 3])).toBeUndefined();
  });

  it.each([
    [-1, { field: '', reason: 'negative-size' }],
    [Number.NaN, { field: '', reason: 'not-finite' }],
    ['4', { field: '', reason: 'not-a-record' }],
    [null, { field: '', reason: 'not-a-record' }],
    [[1, 2, 3], { field: '', reason: 'not-a-record' }],
    [[1, 2, -3, 4], { field: '2', reason: 'negative-size' }],
    [[1, 'x', 3, 4], { field: '1', reason: 'not-a-number' }],
  ])('refuses %j', (value, finding) => {
    expect(frameCornerRadiusReason(value)).toEqual(finding);
  });

  it('is not applied by the door, which leaves a radius to the reader', () => {
    expect(drawableValuesReason('style', { cornerRadius: [1, 2, -3, 4] })).toBeUndefined();
  });
});

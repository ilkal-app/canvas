import { describe, expect, it } from 'vitest';

import { percentile, percentilePair } from './percentiles.js';

describe('percentile', () => {
  it('picks the nearest-rank value, an observed sample, for p50 and p95', () => {
    const values = Array.from({ length: 100 }, (unused, index) => index + 1);
    expect(percentile(values, 0.5)).toBe(50);
    expect(percentile(values, 0.95)).toBe(95);
  });

  it('sorts a copy, so unordered input gives the same answer and is left unchanged', () => {
    const values = [9, 1, 5, 3, 7];
    const before = [...values];
    expect(percentile(values, 0.5)).toBe(5);
    expect(values).toEqual(before);
  });

  it('returns the only value of a single sample for every fraction', () => {
    expect(percentile([4.25], 0)).toBe(4.25);
    expect(percentile([4.25], 0.95)).toBe(4.25);
    expect(percentile([4.25], 1)).toBe(4.25);
  });

  it('returns the minimum at fraction 0 and the maximum at fraction 1', () => {
    expect(percentile([3, 1, 2], 0)).toBe(1);
    expect(percentile([3, 1, 2], 1)).toBe(3);
  });

  it('reads typed arrays as well as plain ones', () => {
    expect(percentile(new Float64Array([2, 8, 4, 6]), 0.5)).toBe(4);
  });

  it('rejects an empty sample, which has no percentile', () => {
    expect(() => percentile([], 0.5)).toThrow(RangeError);
  });

  it('rejects a fraction outside [0, 1] or NaN', () => {
    expect(() => percentile([1], -0.1)).toThrow(RangeError);
    expect(() => percentile([1], 1.5)).toThrow(RangeError);
    expect(() => percentile([1], Number.NaN)).toThrow(RangeError);
  });
});

describe('percentilePair', () => {
  it('gives the median and the 95th percentile together', () => {
    const values = Array.from({ length: 20 }, (unused, index) => 20 - index);
    expect(percentilePair(values)).toEqual({ p50: 10, p95: 19 });
  });
});

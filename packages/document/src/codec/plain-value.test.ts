import { describe, expect, it } from 'vitest';

import { isSamePlainValue } from './plain-value.js';

describe('isSamePlainValue', () => {
  it('compares primitives, null, arrays and nested objects structurally', () => {
    expect(isSamePlainValue(1, 1)).toBe(true);
    expect(isSamePlainValue(null, null)).toBe(true);
    expect(isSamePlainValue([0, 0.5, 1, 1], [0, 0.5, 1, 1])).toBe(true);
    expect(isSamePlainValue({ x: 1, y: { z: [2] } }, { y: { z: [2] }, x: 1 })).toBe(true);
  });

  it('tells apart different values, shapes and kinds', () => {
    expect(isSamePlainValue(1, 2)).toBe(false);
    expect(isSamePlainValue(null, {})).toBe(false);
    expect(isSamePlainValue({}, null)).toBe(false);
    expect(isSamePlainValue([1, 2], [1, 2, 3])).toBe(false);
    expect(isSamePlainValue([1], { 0: 1 })).toBe(false);
    expect(isSamePlainValue({ x: 1 }, { y: 1 })).toBe(false);
    expect(isSamePlainValue({ x: 1 }, { x: 1, y: 2 })).toBe(false);
    expect(isSamePlainValue('1', 1)).toBe(false);
  });
});

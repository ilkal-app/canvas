import { describe, expect, it } from 'vitest';

import { shadowSchema } from '../fields/shadow.js';

import { shadowValueReason } from './shadow-values.js';

/** A shadow the schema accepts. */
const SHADOW = { x: -3, y: 4, blur: 6, spread: -2, color: [0.1, 0.2, 0.3, 0.5] };

describe('shadowValueReason', () => {
  it('accepts absent, null and a shadow within every range, ends included', () => {
    expect(shadowValueReason(undefined)).toBeUndefined();
    expect(shadowValueReason(null)).toBeUndefined();
    expect(shadowValueReason(SHADOW)).toBeUndefined();
    const ends = [
      { x: -1000, y: 1000, blur: 0, spread: -500, color: [0, 0, 0, 0] },
      { x: 1000, y: -1000, blur: 500, spread: 500, color: [1, 1, 1, 1] },
    ];
    for (const shadow of ends) {
      expect(shadowValueReason(shadow)).toBeUndefined();
      expect(shadowSchema.safeParse(shadow).success).toBe(true);
    }
  });

  it('refuses a value that is not a strict record of the five keys', () => {
    for (const value of ['soft', 4, true, [], { ...SHADOW, opacity: 1 }]) {
      expect(shadowValueReason(value)).toEqual({ field: '', reason: 'not-a-record' });
    }
    const missing: Record<string, unknown> = { ...SHADOW };
    delete missing.blur;
    expect(shadowValueReason(missing)).toEqual({ field: '', reason: 'not-a-record' });
  });

  it('takes a list of 1 to 8 layers, naming a refused layer by its index', () => {
    expect(shadowValueReason([SHADOW])).toBeUndefined();
    expect(shadowValueReason(Array(8).fill(SHADOW))).toBeUndefined();
    expect(shadowValueReason(Array(9).fill(SHADOW))).toEqual({ field: '', reason: 'not-a-record' });
    expect(shadowValueReason([1, 2])).toEqual({ field: '0', reason: 'not-a-record' });
    expect(shadowValueReason([SHADOW, { ...SHADOW, blur: -1 }])).toEqual({
      field: '1.blur',
      reason: 'out-of-range',
    });
  });

  it('names the first number out of its range, not finite or not a number', () => {
    const cases: readonly (readonly [Record<string, unknown>, string, string])[] = [
      [{ x: 1000.5 }, 'x', 'out-of-range'],
      [{ y: -1001 }, 'y', 'out-of-range'],
      [{ blur: -0.1 }, 'blur', 'out-of-range'],
      [{ blur: 501 }, 'blur', 'out-of-range'],
      [{ spread: 500.5 }, 'spread', 'out-of-range'],
      [{ x: Number.NaN }, 'x', 'not-finite'],
      [{ blur: Number.POSITIVE_INFINITY }, 'blur', 'not-finite'],
      [{ spread: '2' }, 'spread', 'not-a-number'],
      [{ y: null }, 'y', 'not-a-number'],
      [{ color: [0, 0, 0, 1.5] }, 'color.3', 'out-of-range'],
      [{ color: [0, Number.NaN, 0, 1] }, 'color.1', 'not-finite'],
      [{ color: ['0', 0, 0, 1] }, 'color.0', 'not-a-number'],
      [{ color: [0, 0, 0] }, 'color', 'not-a-record'],
      [{ color: 'ink' }, 'color', 'not-a-record'],
    ];
    for (const [change, field, reason] of cases) {
      const value = { ...SHADOW, ...change };
      expect(shadowValueReason(value)).toEqual({ field, reason });
      // The schema agrees with the door.
      expect(shadowSchema.safeParse(value).success).toBe(false);
    }
  });

  it('does not mutate the value it judges', () => {
    const value = structuredClone(SHADOW);
    shadowValueReason(value);
    expect(value).toEqual(SHADOW);
  });
});

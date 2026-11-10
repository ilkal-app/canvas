import { describe, expect, it } from 'vitest';

import { SCRUB_COARSE_FACTOR, SCRUB_PIXELS_PER_STEP, scrubValue } from './scrub.js';

const FIELD = { start: 10, step: 1, min: 0, max: 100, isCoarse: false } as const;

describe('scrubValue', () => {
  it('moves one step for every few pixels, right up and left down', () => {
    expect(scrubValue({ ...FIELD, deltaPx: 0 })).toBe(10);
    expect(scrubValue({ ...FIELD, deltaPx: SCRUB_PIXELS_PER_STEP })).toBe(11);
    expect(scrubValue({ ...FIELD, deltaPx: SCRUB_PIXELS_PER_STEP * 5 })).toBe(15);
    expect(scrubValue({ ...FIELD, deltaPx: -SCRUB_PIXELS_PER_STEP * 3 })).toBe(7);
  });

  it('counts whole steps only, toward the start', () => {
    expect(scrubValue({ ...FIELD, deltaPx: SCRUB_PIXELS_PER_STEP - 0.5 })).toBe(10);
    expect(scrubValue({ ...FIELD, deltaPx: -(SCRUB_PIXELS_PER_STEP * 2 + 1) })).toBe(8);
  });

  it('steps by ten with Shift', () => {
    expect(SCRUB_COARSE_FACTOR).toBe(10);
    expect(scrubValue({ ...FIELD, isCoarse: true, deltaPx: SCRUB_PIXELS_PER_STEP })).toBe(20);
    expect(scrubValue({ ...FIELD, isCoarse: true, deltaPx: -SCRUB_PIXELS_PER_STEP })).toBe(0);
  });

  it('stays within the field’s bounds', () => {
    expect(scrubValue({ ...FIELD, deltaPx: SCRUB_PIXELS_PER_STEP * 500 })).toBe(100);
    expect(scrubValue({ ...FIELD, isCoarse: true, deltaPx: -SCRUB_PIXELS_PER_STEP * 50 })).toBe(0);
  });

  it('keeps a fractional step’s precision', () => {
    const fine = { ...FIELD, start: 0.1, step: 0.1, max: 1 };
    expect(scrubValue({ ...fine, deltaPx: SCRUB_PIXELS_PER_STEP * 2 })).toBe(0.3);
    expect(scrubValue({ ...fine, isCoarse: true, deltaPx: SCRUB_PIXELS_PER_STEP })).toBe(1);
  });
});

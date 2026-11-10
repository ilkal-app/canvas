import { describe, expect, it } from 'vitest';

import { GRID_MAX_SPACING_PX, GRID_MIN_SPACING_PX, gridSpacingAt } from './grid-spacing.js';

describe('gridSpacingAt', () => {
  it('is 16 world units at 100%, 16 CSS px apart', () => {
    expect(gridSpacingAt(1)).toBe(16);
  });

  it('doubles as the view zooms out and halves as it zooms in', () => {
    expect(gridSpacingAt(0.5)).toBe(32);
    expect(gridSpacingAt(0.25)).toBe(64);
    expect(gridSpacingAt(2)).toBe(8);
    expect(gridSpacingAt(4)).toBe(4);
  });

  it('keeps the dots between 16 and 32 CSS px apart across the whole zoom range', () => {
    for (let zoom = 0.02; zoom <= 64; zoom *= 1.07) {
      const onScreen = gridSpacingAt(zoom) * zoom;
      expect(onScreen).toBeGreaterThanOrEqual(GRID_MIN_SPACING_PX);
      expect(onScreen).toBeLessThan(GRID_MAX_SPACING_PX);
    }
  });

  it('is always a power of two, so every coarser grid is a subset of a finer one', () => {
    for (const zoom of [0.02, 0.3, 1.5, 7, 64]) {
      expect(Number.isInteger(Math.log2(gridSpacingAt(zoom)))).toBe(true);
    }
  });

  it('refuses a zoom that is not positive and finite', () => {
    expect(() => gridSpacingAt(0)).toThrow(RangeError);
    expect(() => gridSpacingAt(Number.NaN)).toThrow(RangeError);
  });
});

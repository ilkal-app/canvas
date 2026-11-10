import { describe, expect, it } from 'vitest';

import { GRID_FADE_FULL_ZOOM, GRID_FADE_HIDDEN_ZOOM, gridOpacityAt } from './grid-fade.js';
import { gridSpacingAt } from './grid-spacing.js';

describe('gridOpacityAt', () => {
  it('fades over one octave of zoom, 25% down to 12.5%', () => {
    expect(GRID_FADE_FULL_ZOOM).toBe(0.25);
    expect(GRID_FADE_HIDDEN_ZOOM).toBe(0.125);
    // One spacing doubling: the band is exactly one step of gridSpacingAt.
    expect(gridSpacingAt(GRID_FADE_HIDDEN_ZOOM)).toBe(2 * gridSpacingAt(GRID_FADE_FULL_ZOOM));
  });

  it('is fully visible at and above the band', () => {
    for (const zoom of [GRID_FADE_FULL_ZOOM, 0.3, 0.5, 1, 4, 64])
      expect(gridOpacityAt(zoom)).toBe(1);
  });

  it('is zero at the band’s foot and below it', () => {
    for (const zoom of [GRID_FADE_HIDDEN_ZOOM, 0.1, 0.05, 0.02])
      expect(gridOpacityAt(zoom)).toBe(0);
  });

  it('is half at the band’s middle and rises smoothly across it', () => {
    expect(gridOpacityAt(0.1875)).toBe(0.5);
    let previous = 0;
    for (let step = 1; step < 64; step += 1) {
      const zoom =
        GRID_FADE_HIDDEN_ZOOM + (step / 64) * (GRID_FADE_FULL_ZOOM - GRID_FADE_HIDDEN_ZOOM);
      const opacity = gridOpacityAt(zoom);
      expect(opacity).toBeGreaterThan(previous);
      expect(opacity).toBeLessThan(1);
      // No pop: a 1/64 step of the band changes the opacity by under 1/32 (smoothstep's slope
      // peaks at 1.5).
      expect(opacity - previous).toBeLessThan(1 / 32);
      previous = opacity;
    }
  });

  it('meets the ends of the band without a step', () => {
    expect(gridOpacityAt(GRID_FADE_HIDDEN_ZOOM * 1.0001)).toBeLessThan(1e-6);
    expect(gridOpacityAt(GRID_FADE_FULL_ZOOM * 0.9999)).toBeGreaterThan(1 - 1e-6);
  });

  it('refuses a zoom that is not positive and finite', () => {
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => gridOpacityAt(zoom)).toThrow(RangeError);
    }
  });
});

import { describe, expect, it } from 'vitest';

import { clampZoom, MAX_ZOOM, MIN_ZOOM } from './zoom-range.js';

describe('clampZoom', () => {
  it('keeps a zoom factor inside the supported range unchanged', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
  });

  it('spans the navigable range, 0.02× to 64×', () => {
    expect([MIN_ZOOM, MAX_ZOOM]).toEqual([0.02, 64]);
  });

  it('raises a zoom factor below the range to the minimum', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(-2)).toBe(MIN_ZOOM);
  });

  it('lowers a zoom factor above the range, including infinity, to the maximum', () => {
    expect(clampZoom(128)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM);
  });

  it('rejects NaN instead of propagating it into the camera', () => {
    expect(() => clampZoom(Number.NaN)).toThrow(RangeError);
  });
});

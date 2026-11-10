import { describe, expect, it } from 'vitest';

import type { GlyphOutline } from '@canvas/text';

import {
  COVERAGE_FLATTENING_TOLERANCE_PX,
  coverageToImage,
  rasterizeCoverage,
} from './coverage-raster.js';

/**
 * A circle of four cubic arcs, centred in em, y up.
 *
 * @param cx - The centre's x.
 * @param cy - Its y.
 * @param r - The radius.
 * @returns The outline.
 */
function circle(cx: number, cy: number, r: number): GlyphOutline {
  // The usual cubic approximation of a quarter circle.
  const k = 0.5522847498 * r;
  return {
    contours: [
      [
        {
          kind: 'cubic',
          x0: cx + r,
          y0: cy,
          c1x: cx + r,
          c1y: cy + k,
          c2x: cx + k,
          c2y: cy + r,
          x1: cx,
          y1: cy + r,
        },
        {
          kind: 'cubic',
          x0: cx,
          y0: cy + r,
          c1x: cx - k,
          c1y: cy + r,
          c2x: cx - r,
          c2y: cy + k,
          x1: cx - r,
          y1: cy,
        },
        {
          kind: 'cubic',
          x0: cx - r,
          y0: cy,
          c1x: cx - r,
          c1y: cy - k,
          c2x: cx - k,
          c2y: cy - r,
          x1: cx,
          y1: cy - r,
        },
        {
          kind: 'cubic',
          x0: cx,
          y0: cy - r,
          c1x: cx + k,
          c1y: cy - r,
          c2x: cx + r,
          c2y: cy - k,
          x1: cx + r,
          y1: cy,
        },
      ],
    ],
  };
}

/**
 * Sums a raster's coverage.
 *
 * @param coverage - The coverage.
 * @returns Its area, in px².
 */
function area(coverage: Float32Array): number {
  return coverage.reduce((total, value) => total + value, 0);
}

describe('rasterizeCoverage', () => {
  it('flattens cubics to within the tolerance: a circle keeps its area', () => {
    const coverage = rasterizeCoverage(
      [{ outline: circle(0, 0, 1), originXPx: 8, baselineYPx: 8, fontSizePx: 6 }],
      { widthPx: 16, heightPx: 16, fillRule: 'nonzero' },
    );
    // Chords lie inside the curve: the area falls short by at most the perimeter × the tolerance.
    const shortfall = Math.PI * 36 - area(coverage);
    expect(shortfall).toBeGreaterThanOrEqual(-0.05);
    expect(shortfall).toBeLessThanOrEqual(2 * Math.PI * 6 * COVERAGE_FLATTENING_TOLERANCE_PX);
    expect(coverage[8 * 16 + 8]).toBe(1);
    expect(coverage[0]).toBe(0);
  });

  it('flattens to a finer tolerance when asked, and refuses one not positive and finite', () => {
    const fine = 1 / 512;
    const placed = [{ outline: circle(0, 0, 1), originXPx: 8, baselineYPx: 8, fontSizePx: 6 }];
    const size = { widthPx: 16, heightPx: 16, fillRule: 'nonzero' as const };
    const shortfall =
      Math.PI * 36 - area(rasterizeCoverage(placed, { ...size, flatteningTolerancePx: fine }));
    expect(shortfall).toBeGreaterThanOrEqual(-0.05);
    expect(shortfall).toBeLessThanOrEqual(2 * Math.PI * 6 * fine);
    for (const flatteningTolerancePx of [0, -1, Infinity, Number.NaN])
      expect(() => rasterizeCoverage(placed, { ...size, flatteningTolerancePx })).toThrow(
        RangeError,
      );
  });

  it('clamps a shape that runs past the raster to its sides, keeping what lies inside', () => {
    const square: GlyphOutline = {
      contours: [
        [
          { kind: 'line', x0: -3, y0: 2, x1: 6, y1: 2 },
          { kind: 'line', x0: 6, y0: 2, x1: 6, y1: 1 },
          { kind: 'line', x0: 6, y0: 1, x1: -3, y1: 1 },
          { kind: 'line', x0: -3, y0: 1, x1: -3, y1: 2 },
        ],
      ],
    };
    const coverage = rasterizeCoverage(
      [{ outline: square, originXPx: 0, baselineYPx: 4, fontSizePx: 1 }],
      { widthPx: 4, heightPx: 4, fillRule: 'nonzero' },
    );
    expect([...coverage.slice(8, 12)]).toEqual([1, 1, 1, 1]);
    expect(area(coverage)).toBe(4);
  });

  it('draws nothing for no outlines', () => {
    expect(area(rasterizeCoverage([], { widthPx: 3, heightPx: 2, fillRule: 'nonzero' }))).toBe(0);
  });
});

describe('coverageToImage', () => {
  it('composites translucent ink over a transparent background, which lends no colour', () => {
    const image = coverageToImage(new Float32Array([1, 0]), {
      widthPx: 2,
      heightPx: 1,
      color: [255, 0, 0, 128],
      background: [0, 0, 255, 0],
      gamma: 'srgb',
    });
    expect([...image.data.slice(0, 4)]).toEqual([255, 0, 0, 128]);
    expect([...image.data.slice(4, 8)]).toEqual([0, 0, 255, 0]);
  });

  it('mixes half-strength ink with an opaque background in linear light', () => {
    const image = coverageToImage(new Float32Array([1]), {
      widthPx: 1,
      heightPx: 1,
      color: [255, 0, 0, 128],
      background: [0, 0, 255, 255],
      gamma: 'srgb',
    });
    const [red, green, blue, alpha] = image.data;
    // Linear 0.5 encodes to sRGB 187.5, which rounds either way in floating point.
    expect(Math.abs((red ?? 0) - 188)).toBeLessThanOrEqual(1);
    expect(Math.abs((blue ?? 0) - 188)).toBeLessThanOrEqual(1);
    expect([green, alpha]).toEqual([0, 255]);
  });
});

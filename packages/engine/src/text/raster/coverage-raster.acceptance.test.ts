import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseFont, type GlyphOutline } from '@canvas/text';

interface PositionedOutline {
  readonly outline: GlyphOutline;
  readonly originXPx: number;
  readonly baselineYPx: number;
  readonly fontSizePx: number;
}

interface CoverageRaster {
  rasterizeCoverage(
    outlines: readonly PositionedOutline[],
    options: { readonly widthPx: number; readonly heightPx: number; readonly fillRule: 'nonzero' },
  ): Float32Array;
  coverageToImage(
    coverage: Float32Array,
    options: {
      readonly widthPx: number;
      readonly heightPx: number;
      readonly color: readonly [number, number, number, number];
      readonly background: readonly [number, number, number, number];
      readonly gamma: 'srgb';
    },
  ): { readonly data: Uint8Array };
}

/**
 * Loads the coverage raster API through a string path while its module is still absent.
 *
 * @returns The raster module.
 */
async function coverageRaster(): Promise<CoverageRaster> {
  const path = './coverage-raster.js';
  return (await import(path)) as CoverageRaster;
}

/**
 * Makes a closed line contour in em units, with y positive upward.
 *
 * @param points - Vertices in winding order.
 * @returns The line segments.
 */
function contour(points: readonly (readonly [number, number])[]): GlyphOutline['contours'][number] {
  return points.map(([x0, y0], index) => {
    const [x1, y1] = points[(index + 1) % points.length] ?? [x0, y0];
    return { kind: 'line', x0, y0, x1, y1 };
  });
}

/**
 * Positions an outline at one device pixel per em for analytic polygon fixtures.
 *
 * @param outline - The em-unit shape.
 * @returns Its device position.
 */
function placed(outline: GlyphOutline): PositionedOutline {
  return { outline, originXPx: 0, baselineYPx: 4, fontSizePx: 1 };
}

/**
 * Sums every pixel's area coverage.
 *
 * @param coverage - Pixel coverage values.
 * @returns Area in device pixels squared.
 */
function sum(coverage: Float32Array): number {
  return coverage.reduce((total, pixel) => total + pixel, 0);
}

/**
 * Runs a 4 by 4 non-zero fill raster for one outline.
 *
 * @param outline - The polygon to rasterise.
 * @returns Sixteen coverage values.
 */
async function raster(outline: GlyphOutline): Promise<Float32Array> {
  return (await coverageRaster()).rasterizeCoverage([placed(outline)], {
    widthPx: 4,
    heightPx: 4,
    fillRule: 'nonzero',
  });
}

describe('rasterizeCoverage', () => {
  it('fills an axis-aligned square exactly inside its integer pixel boundaries', async () => {
    const pixels = await raster({
      contours: [
        contour([
          [1, 3],
          [3, 3],
          [3, 1],
          [1, 1],
        ]),
      ],
    });
    expect(pixels).toBeInstanceOf(Float32Array);
    expect([...pixels]).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0]);
  });

  it('gives half coverage at both edges of a half-pixel shifted square', async () => {
    const pixels = await raster({
      contours: [
        contour([
          [0.5, 3],
          [2.5, 3],
          [2.5, 1],
          [0.5, 1],
        ]),
      ],
    });
    expect([...pixels.slice(4, 8)]).toEqual([0.5, 1, 0.5, 0]);
    expect(sum(pixels)).toBeCloseTo(4, 6);
  });

  it('integrates a 45-degree edge to the analytic triangle areas', async () => {
    const pixels = await raster({
      contours: [
        contour([
          [0, 4],
          [2, 4],
          [0, 2],
        ]),
      ],
    });
    expect(pixels[0]).toBe(1);
    expect(pixels[1]).toBeCloseTo(0.5, 6);
    expect(pixels[4]).toBeCloseTo(0.5, 6);
    expect(pixels[5]).toBe(0);
    expect(sum(pixels)).toBeCloseTo(2, 6);
  });

  it('uses non-zero winding so a counter-wound inner contour leaves a hole', async () => {
    const pixels = await raster({
      contours: [
        contour([
          [0, 4],
          [4, 4],
          [4, 0],
          [0, 0],
        ]),
        contour([
          [1, 3],
          [1, 1],
          [3, 1],
          [3, 3],
        ]),
      ],
    });
    expect(pixels[5]).toBe(0);
    expect(pixels[0]).toBe(1);
    expect(sum(pixels)).toBeCloseTo(12, 6);
  });

  it('conserves the area of an arbitrary slanted polygon within 1e-3', async () => {
    const pixels = await raster({
      contours: [
        contour([
          [0.2, 3.7],
          [3.4, 3.3],
          [2.6, 0.4],
        ]),
      ],
    });
    const polygonArea = Math.abs(
      (0.2 * 3.3 + 3.4 * 0.4 + 2.6 * 3.7 - 3.7 * 3.4 - 3.3 * 2.6 - 0.4 * 0.2) / 2,
    );
    expect(sum(pixels)).toBeCloseTo(polygonArea, 3);
    expect([...pixels].every((pixel) => pixel >= 0 && pixel <= 1)).toBe(true);
  });

  it('flattens a quadratic cap finely enough to retain its analytic area', async () => {
    const outline: GlyphOutline = {
      contours: [
        [
          { kind: 'quadratic', x0: 0, y0: 2, cx: 1, cy: 3, x1: 2, y1: 2 },
          { kind: 'line', x0: 2, y0: 2, x1: 0, y1: 2 },
        ],
      ],
    };
    const before = JSON.stringify(outline);
    const pixels = await raster(outline);
    expect(Math.abs(sum(pixels) - 2 / 3)).toBeLessThan(0.045);
    expect(JSON.stringify(outline)).toBe(before);
  });

  it('conserves the outline area of bundled Inter 400 H at 8 device pixels per em', async () => {
    const bytes = readFileSync(
      new URL('../../../../app/assets/fonts/library/inter/400.ttf', import.meta.url),
    );
    const font = parseFont(bytes);
    const outline = font.outlineOf(font.glyphIdOf('H'.codePointAt(0) ?? 0));
    const edges = outline.contours.flatMap((loop) => loop);
    expect(edges.every((edge) => edge.kind === 'line')).toBe(true);
    const areaEm = Math.abs(
      outline.contours.reduce(
        (area, loop) =>
          area + loop.reduce((cross, edge) => cross + edge.x0 * edge.y1 - edge.x1 * edge.y0, 0) / 2,
        0,
      ),
    );
    const pixels = (await coverageRaster()).rasterizeCoverage(
      [{ outline, originXPx: 2, baselineYPx: 10, fontSizePx: 8 }],
      { widthPx: 16, heightPx: 16, fillRule: 'nonzero' },
    );
    expect(sum(pixels)).toBeCloseTo(areaEm * 64, 2);
  });
});

describe('coverageToImage', () => {
  it('composites half-covered black over white in linear light then encodes sRGB', async () => {
    const image = (await coverageRaster()).coverageToImage(new Float32Array([0.5]), {
      widthPx: 1,
      heightPx: 1,
      color: [0, 0, 0, 255],
      background: [255, 255, 255, 255],
      gamma: 'srgb',
    });
    expect([...image.data]).toEqual([188, 188, 188, 255]);
  });
});

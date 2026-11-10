/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { createFontMetrics } from '../font/font-metrics.js';
import { parseFont } from '../font/parse-font.js';

import { createShaper, loadShaper, shapeText } from './shaper.js';
import { createShapingMeasurer } from './shaping-measurer.js';

type FeatureMap = Readonly<Record<string, number>>;
type FeatureShape = (
  shaper: Parameters<typeof shapeText>[0],
  face: Parameters<typeof shapeText>[1],
  text: string,
  start: number,
  end: number,
  direction: 'ltr' | 'rtl' | undefined,
  language: string | undefined,
  features: FeatureMap,
) => ReturnType<typeof shapeText>;
const shapeWithFeatures = shapeText as FeatureShape;

/**
 * Reads a checked-in font face for a feature acceptance case.
 *
 * @param path - Path relative to this file.
 * @param family - Font family.
 * @returns Font bytes and metrics.
 */
function font(path: string, family: string) {
  const bytes = new Uint8Array(readFileSync(new URL(path, import.meta.url)));
  const metrics = createFontMetrics({ family, weight: 400, isItalic: false }, parseFont(bytes));
  return { bytes, metrics };
}

/**
 * Adds the shaped glyph advances in em.
 *
 * @param glyphs - Shaped glyphs.
 * @returns Advance in em.
 */
function advance(glyphs: readonly { readonly advance: number }[]): number {
  return glyphs.reduce((sum, glyph) => sum + glyph.advance, 0);
}

const garamond = font('../../../app/assets/fonts/library/ebgaramond/400.ttf', 'EB Garamond');
const inter = font('../../../app/assets/fonts/library/inter/400.ttf', 'Inter');
const dmSans = font('../../../app/assets/fonts/library/dmsans/400.ttf', 'DM Sans');

describe('OpenType feature shaping', () => {
  it('passes sorted feature strings to HarfBuzz and keeps the default call unchanged', async () => {
    const hb = await import('harfbuzzjs');
    const hbShape = vi.fn(hb.shape);
    const shaper = createShaper({ ...hb, shape: hbShape });
    const face = shaper.face('features-args', garamond.bytes);
    shapeText(shaper, face, 'office', 0, 6);
    expect(hbShape.mock.calls[0]).toHaveLength(2);
    const defaultGlyphs = shapeText(shaper, face, 'office', 0, 6);
    expect(defaultGlyphs).toEqual(shapeText(shaper, face, 'office', 0, 6));
    shapeWithFeatures(shaper, face, 'office', 0, 6, undefined, undefined, {
      tnum: 1,
      liga: 0,
      aalt: 2,
    });
    expect(
      hbShape.mock.calls.at(-1)?.[2]?.map((feature) => `${feature.tag}=${String(feature.value)}`),
    ).toEqual(['aalt=2', 'liga=0', 'tnum=1']);
  });

  it('turns off the ffi/fi ligature in EB Garamond', async () => {
    const shaper = await loadShaper();
    const face = shaper.face('features-liga', garamond.bytes);
    const normal = shapeText(shaper, face, 'office', 0, 6);
    const disabled = shapeWithFeatures(shaper, face, 'office', 0, 6, undefined, undefined, {
      liga: 0,
    });
    expect(normal.glyphs.length).toBeLessThan(6);
    expect(disabled.glyphs).toHaveLength(6);
  });

  it('makes Inter proportional digits tabular with tnum', async () => {
    const shaper = await loadShaper();
    const face = shaper.face('features-tnum', inter.bytes);
    const normalOnes = advance(shapeText(shaper, face, '1111', 0, 4).glyphs);
    const normalZeros = advance(shapeText(shaper, face, '0000', 0, 4).glyphs);
    const tabularOnes = advance(
      shapeWithFeatures(shaper, face, '1111', 0, 4, undefined, undefined, { tnum: 1 }).glyphs,
    );
    const tabularZeros = advance(
      shapeWithFeatures(shaper, face, '0000', 0, 4, undefined, undefined, { tnum: 1 }).glyphs,
    );
    expect(normalOnes).not.toBeCloseTo(normalZeros, 8);
    expect(tabularOnes).toBeCloseTo(tabularZeros, 8);
  });

  it('disables GPOS kerning for DM Sans AV', async () => {
    const shaper = await loadShaper();
    const face = shaper.face('features-kern', dmSans.bytes);
    const normal = advance(shapeText(shaper, face, 'AV', 0, 2).glyphs);
    const unkerned = advance(
      shapeWithFeatures(shaper, face, 'AV', 0, 2, undefined, undefined, { kern: 0 }).glyphs,
    );
    expect(unkerned).toBeGreaterThan(normal);
  });

  it('passes features through the shaping measurer', async () => {
    const measurer = createShapingMeasurer(await loadShaper(), [garamond]);
    const faceId = measurer.faceIdOf({
      fontFamily: 'EB Garamond',
      fontSize: 20,
      color: 'ink',
      weight: 400,
      italic: false,
    });
    if (measurer.shape === undefined) throw new Error('Expected shaping measurer');
    const shape = measurer.shape as (
      faceId: string,
      text: string,
      start: number,
      end: number,
      direction: 'ltr' | 'rtl' | undefined,
      variations: FeatureMap | undefined,
      language: string | undefined,
      features: FeatureMap,
    ) => ReturnType<NonNullable<typeof measurer.shape>>;
    expect(
      shape(faceId, 'office', 0, 6, undefined, undefined, undefined, { liga: 0 }).glyphs,
    ).toHaveLength(6);
  });
});

import { describe, expect, it } from 'vitest';

import { loadBundledFaces } from '../__fixtures__/bundled-fonts.js';

import {
  createFontMetrics,
  FontMetricsLookup,
  subsetFontMetrics,
  type FontMetrics,
} from './font-metrics.js';
import { parseFont, type ParsedFont } from './parse-font.js';

const cp = (character: string): number => character.codePointAt(0) ?? 0;

function regularMetrics(): FontMetrics {
  const [regular] = loadBundledFaces();
  if (regular === undefined) throw new Error('The bundled regular face is missing.');
  return createFontMetrics(regular.face, parseFont(regular.bytes));
}

describe('createFontMetrics', () => {
  const metrics = regularMetrics();

  it('lists every mapped codepoint in ascending order with its advance in em', () => {
    const codepoints = metrics.advances.map(([codepoint]) => codepoint);
    expect(codepoints.length).toBeGreaterThan(600);
    expect(codepoints).toEqual([...codepoints].sort((a, b) => a - b));
    const lookup = new FontMetricsLookup(metrics);
    expect(lookup.advance(cp('A'))).toBe(0.6669921875);
    expect(lookup.advance(cp(' '))).toBe(0.27783203125);
  });

  it('keeps the face, the vertical metrics and the .notdef advance', () => {
    expect(metrics.face).toEqual({ family: 'Liberation Sans', weight: 400, isItalic: false });
    expect([metrics.ascent, metrics.descent]).toEqual([0.9052734375, 0.2119140625]);
    expect(metrics.missingAdvance).toBeGreaterThan(0);
    expect(new FontMetricsLookup(metrics).advance(0x1f600)).toBe(metrics.missingAdvance);
  });

  it('turns glyph kerning pairs into codepoint pairs', () => {
    const lookup = new FontMetricsLookup(metrics);
    expect(lookup.kerning(cp('A'), cp('V'))).toBe(-0.07421875);
    expect(lookup.kerning(cp('T'), cp('o'))).toBe(-0.11083984375);
    expect(lookup.kerning(cp('a'), cp('v'))).toBe(0);
    expect(metrics.kerning.length).toBeGreaterThan(100);
  });
});

describe('createFontMetrics over shared and unmapped glyphs', () => {
  it('kerns every codepoint of a shared glyph and skips pairs of unmapped glyphs', () => {
    const font = {
      unitsPerEm: 1000,
      ascent: 0.8,
      descent: 0.2,
      glyphIdOf: () => 0,
      advanceOf: (glyphId: number) => glyphId / 10,
      kerningOf: () => 0,
      characterMap: () => [
        [65, 1],
        [0x391, 1],
        [86, 2],
      ],
      kerningPairs: () => [
        [1, 2, -0.05],
        [7, 2, -0.1],
      ],
    } as unknown as ParsedFont;
    const metrics = createFontMetrics({ family: 'Stub', weight: 400, isItalic: false }, font);
    expect(metrics.kerning).toEqual([
      [65, 86, -0.05],
      [0x391, 86, -0.05],
    ]);
  });
});

describe('subsetFontMetrics', () => {
  const metrics = regularMetrics();

  it('keeps only the given codepoints and the kerning pairs between them', () => {
    const subset = subsetFontMetrics(metrics, [cp('T'), cp('o'), cp('V'), 0x1f600]);
    expect(subset.advances.map(([codepoint]) => codepoint)).toEqual([cp('T'), cp('V'), cp('o')]);
    const lookup = new FontMetricsLookup(subset);
    expect(lookup.kerning(cp('T'), cp('o'))).toBe(-0.11083984375);
    expect(lookup.kerning(cp('A'), cp('V'))).toBe(0);
    expect(subset.kerning.length).toBeLessThan(5);
    expect(subset.missingAdvance).toBe(metrics.missingAdvance);
    expect(subset.face).toBe(metrics.face);
  });

  it('leaves the full table unchanged', () => {
    const before = metrics.advances.length;
    subsetFontMetrics(metrics, [cp('a')]);
    expect(metrics.advances.length).toBe(before);
  });
});

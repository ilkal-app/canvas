/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseFont } from '../index.js';

import { loadShaper, shapeText } from './__fixtures__/shaping-contract.js';
import { acceptanceFont } from './__fixtures__/shaping-fonts.js';

interface HbGlyph {
  readonly g: number;
  readonly cl: number;
  readonly ax: number;
  readonly dx: number;
  readonly dy: number;
  readonly fl?: number;
}

interface HbSample {
  readonly name: Parameters<typeof acceptanceFont>[0];
  readonly text: string;
  readonly glyphs: readonly HbGlyph[];
}

interface HbFixture {
  readonly harfBuzzVersion: string;
  readonly samples: readonly HbSample[];
}

const fixture = JSON.parse(
  readFileSync(new URL('./__fixtures__/hb-shape-14.2.1.json', import.meta.url), 'utf8'),
) as HbFixture;

/**
 * hb-shape defaults to Unicode scalar clusters; --utf8-clusters is deliberately absent.
 * Convert each scalar index to a UTF-16 offset, which is shapeText's public index unit.
 *
 * @param text - The shaped input.
 * @param scalarIndex - hb-shape's cluster index.
 * @returns The matching UTF-16 index.
 */
function utf16Index(text: string, scalarIndex: number): number {
  return Array.from(text).slice(0, scalarIndex).join('').length;
}

describe('HarfBuzz shaping against hb-shape 14.2.1', () => {
  it('loads one shaper per process and caches faces by id', async () => {
    const first = await loadShaper();
    const second = await loadShaper();
    expect(second).toBe(first);
    expect(first.version).toBe('14.5.0');

    const regular = acceptanceFont('liberation-sans');
    const other = acceptanceFont('dm-sans');
    const face = first.face('acceptance-cache', regular.bytes);
    expect(face.id).toBe('acceptance-cache');
    expect(face.unitsPerEm).toBe(parseFont(regular.bytes).unitsPerEm);
    expect(first.face('acceptance-cache', other.bytes)).toBe(face);
  });

  it.each(fixture.samples)('matches hb-shape for $name', async (sample) => {
    const shaper = await loadShaper();
    const font = acceptanceFont(sample.name);
    const face = shaper.face(`oracle-${sample.name}`, font.bytes);
    const shaped = shapeText(shaper, face, sample.text, 0, sample.text.length);
    expect(shaped.direction).toBe(sample.name === 'noto-sans-arabic' ? 'rtl' : 'ltr');
    expect(shaped.glyphs).toHaveLength(sample.glyphs.length);
    for (const [index, glyph] of shaped.glyphs.entries()) {
      const oracle = sample.glyphs[index];
      expect(oracle).toBeDefined();
      if (oracle === undefined) continue;
      expect(glyph.glyphId).toBe(oracle.g);
      expect(glyph.cluster).toBe(utf16Index(sample.text, oracle.cl));
      expect(glyph.advance * face.unitsPerEm).toBeCloseTo(oracle.ax, 10);
      expect(glyph.xOffset * face.unitsPerEm).toBeCloseTo(oracle.dx, 10);
      expect(glyph.yOffset * face.unitsPerEm).toBeCloseTo(oracle.dy, 10);
      expect(glyph.isUnsafeToBreak).toBe(Boolean((oracle.fl ?? 0) & 1));
    }
  });

  it('reports the fixture and runtime HarfBuzz versions independently', async () => {
    expect(fixture.harfBuzzVersion).toBe('14.2.1');
    expect((await loadShaper()).version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('keeps clusters indexed in the whole string when shaping a substring', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('eb-garamond');
    const face = shaper.face('substring-eb-garamond', font.bytes);
    const text = '😀office!';
    const full = shapeText(shaper, face, 'office', 0, 6);
    const slice = shapeText(shaper, face, text, 2, 8);
    expect(slice.glyphs.map((glyph) => glyph.glyphId)).toEqual(
      full.glyphs.map((glyph) => glyph.glyphId),
    );
    expect(slice.glyphs.map((glyph) => glyph.cluster)).toEqual(
      full.glyphs.map((glyph) => glyph.cluster + 2),
    );
  });
});

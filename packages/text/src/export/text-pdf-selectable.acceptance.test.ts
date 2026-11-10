// Selection is carried by invisible, logically ordered PDF text.
import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';

import {
  createShapingMeasurer,
  fsTypeOf,
  layoutText,
  loadShaper,
  parseFont,
  textPdf,
  textVectors,
  type TextLayout,
  type VectorGlyph,
} from '../index.js';
import { acceptanceFont } from '../shaping/__fixtures__/shaping-fonts.js';

const OPTIONS = { namePrefix: 'Sel', colorOf: () => [0, 0, 0, 1] as const };

/** The embedded font fields inspected before the implementation is present. */
type TestFont =
  | { readonly kind: 'standard'; readonly baseFont: 'Helvetica' }
  | {
      readonly kind: 'embedded';
      readonly unitsPerEm: number;
      readonly ascent: number;
      readonly descent: number;
      readonly widths: readonly (readonly [number, number])[];
      readonly toUnicode: readonly (readonly [number, string])[];
    };

/**
 * Reads the forthcoming font resource without requiring the implementation's type yet.
 *
 * @param resources - Resources with or without embedded fonts.
 * @returns Named font resources, if present.
 */
function fontsOf(resources: object): Readonly<Record<string, TestFont>> | undefined {
  return (resources as { readonly fonts?: Readonly<Record<string, TestFont>> }).fonts;
}

/**
 * Encodes source text as a PDF UTF-16BE hex string with a BOM.
 *
 * @param source - Text in JavaScript's UTF-16 representation.
 * @returns The bracketed PDF hex string.
 */
function actualText(source: string): string {
  let hex = 'FEFF';
  for (let index = 0; index < source.length; index += 1)
    hex += source.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

/**
 * Makes a layout and its outline vectors using the checked-in font and HarfBuzz.
 *
 * @param family - Bundled fixture family.
 * @param source - Source text.
 * @returns Real shaped layout, vectors, and embeddable font bytes.
 */
async function shaped(
  family: 'eb-garamond' | 'noto-sans-arabic',
  source: string,
): Promise<{ layout: TextLayout; vectors: VectorGlyph[]; bytes: Uint8Array }> {
  const shaper = await loadShaper();
  const font = acceptanceFont(family);
  const style: TextStyle = {
    fontFamily: font.metrics.face.family,
    fontSize: 20,
    color: [0, 0, 0, 1],
    weight: 400,
    italic: false,
  };
  const layout = layoutText(
    source,
    [{ length: source.length, style }],
    null,
    createShapingMeasurer(shaper, [font]),
  );
  const faceId = layout.runs[0]?.faceId;
  if (faceId === undefined) throw new Error('missing shaped face');
  return {
    layout,
    vectors: textVectors(layout, {
      outline: (id, glyphId) => shaper.outline(shaper.face(id, font.bytes), glyphId),
    }),
    bytes: font.bytes,
  };
}

/**
 * Minimal vector for a hand-positioned glyph.
 *
 * @param glyphId - Embedded glyph id.
 * @param faceId - Face name.
 * @param start - First source code unit.
 * @param end - One past the last source code unit.
 * @returns A visible outline vector.
 */
function vector(glyphId: number, faceId: string, start: number, end: number): VectorGlyph {
  return {
    kind: 'outline',
    glyphId,
    faceId,
    cluster: { start, end },
    d: '',
    pdf: '0 0 m 1 0 l h',
    fill: 'ink',
  };
}

/**
 * A hand-positioned line, preserving caller order for several glyphs in one cluster.
 *
 * @param source - Source text.
 * @param glyphs - Glyph ids, clusters, positions, and runs.
 * @param runs - Faces and font sizes.
 * @returns The text layout.
 */
function handLayout(
  source: string,
  glyphs: readonly {
    glyphId: number;
    index: number;
    end: number;
    x: number;
    y: number;
    run: number;
  }[],
  runs: TextLayout['runs'] = [{ faceId: 'lora', fontSize: 18, color: 'ink' }],
): TextLayout {
  return {
    text: source,
    runs,
    glyphs: glyphs.map((glyph) => ({
      ...glyph,
      codepoint: source.codePointAt(glyph.index) ?? 0,
      level: 0,
      line: 0,
      advance: 7,
    })),
    lines: [
      {
        start: 0,
        end: source.length,
        isHard: true,
        x: 0,
        y: 0,
        height: 25,
        ascent: 18,
        descent: 7,
        baseline: 18,
        width: 40,
      },
    ],
    width: 40,
    height: 25,
  };
}

describe('textPdf selectable layer', () => {
  it('keeps the vector-only result byte-for-byte when selectable is absent', async () => {
    const layout = handLayout('A', [{ glyphId: 1, index: 0, end: 1, x: 2, y: 18, run: 0 }]);
    const result = await textPdf(layout, [vector(1, 'lora', 0, 1)], OPTIONS);
    expect(result.content).not.toMatch(/\bBT\b/);
    expect(fontsOf(result.resources)).toBeUndefined();
    expect(await textPdf(layout, [vector(1, 'lora', 0, 1)], OPTIONS)).toEqual(result);
  });

  it('embeds the real EB Garamond ffi ligature and maps its one glyph to all three characters', async () => {
    const { layout, vectors, bytes } = await shaped('eb-garamond', 'office');
    expect(fsTypeOf(bytes).canEmbed).toBe(true);
    const result = await textPdf(layout, vectors, {
      ...OPTIONS,
      selectable: { embed: () => ({ bytes, format: 'truetype' }) },
    });
    const spans = [
      ...result.content.matchAll(/\/Span << \/ActualText (<[0-9A-F]+>) >> BDC([\s\S]*?)EMC/g),
    ];
    expect(spans.map((match) => match[1])).toEqual(['o', 'ffi', 'c', 'e'].map(actualText));
    const ligature = layout.glyphs.find((glyph) => glyph.index === 1 && glyph.end === 4);
    expect(ligature?.glyphId).not.toBeNull();
    const font = fontsOf(result.resources)?.SelF1;
    expect(font?.kind).toBe('embedded');
    if (font?.kind !== 'embedded' || ligature?.glyphId == null) return;
    expect(font.toUnicode).toContainEqual([ligature.glyphId, 'ffi']);
    expect(spans[1]?.[2]).toContain(
      `<${ligature.glyphId.toString(16).padStart(4, '0').toUpperCase()}> Tj`,
    );
    const parsed = parseFont(bytes);
    expect(font.unitsPerEm).toBe(parsed.unitsPerEm);
    expect(font.ascent).toBeCloseTo(parsed.ascent * parsed.unitsPerEm);
    expect(font.descent).toBeCloseTo(parsed.descent * parsed.unitsPerEm);
    expect(font.widths).toContainEqual([
      ligature.glyphId,
      Math.round(parsed.advanceOf(ligature.glyphId) * 1000),
    ]);
    expect(font.widths.map(([id]) => id)).toEqual(
      [...new Set(font.widths.map(([id]) => id))].sort((a, b) => a - b),
    );
    expect(result.warnings).toEqual([]);
  });

  it('orders real Noto Sans Arabic clusters by source index despite visual-order vectors', async () => {
    const { layout, vectors, bytes } = await shaped('noto-sans-arabic', 'سلام');
    const starts = vectors.map((glyph) => glyph.cluster.start);
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
    const result = await textPdf(layout, vectors, {
      ...OPTIONS,
      selectable: { embed: () => ({ bytes, format: 'truetype' }) },
    });
    const spans = [...result.content.matchAll(/\/ActualText (<[0-9A-F]+>)/g)].map(
      (match) => match[1],
    );
    const expected = [
      ...new Map(
        vectors.map(({ cluster }) => [
          cluster.start,
          layout.text.slice(cluster.start, cluster.end),
        ]),
      ).entries(),
    ]
      .sort(([a], [b]) => a - b)
      .map(([, value]) => actualText(value));
    expect(spans).toEqual(expected);
    expect(fontsOf(result.resources)?.SelF1?.kind).toBe('embedded');
  });

  it('places every embedded glyph at its own pen and baseline inside one invisible BT/ET', async () => {
    const bytes = acceptanceFont('eb-garamond').bytes;
    const glyphs = [
      { glyphId: 10, index: 0, end: 2, x: 4.25, y: 17.5, run: 0 },
      { glyphId: 11, index: 0, end: 2, x: 9.5, y: 18, run: 0 },
    ];
    const layout = handLayout('ab', glyphs);
    const result = await textPdf(
      layout,
      glyphs.map((glyph) => vector(glyph.glyphId, 'lora', 0, 2)),
      {
        ...OPTIONS,
        transform: { a: 1, b: 0, c: 0, d: -1, e: 3, f: 90 },
        selectable: { embed: () => ({ bytes, format: 'truetype' }) },
      },
    );
    expect(result.content).toMatch(/^q\n1 0 0 -1 3 90 cm[\s\S]*\nBT\n3 Tr[\s\S]*ET\nQ\n$/);
    expect(result.content.match(/\bBT\b/g)).toHaveLength(1);
    expect(result.content).toContain(`/ActualText ${actualText('ab')}`);
    expect(result.content).toMatch(/\/SelF1 18 Tf\s+1 0 0 -1 4\.25 17\.5 Tm\s+<000A> Tj/);
    expect(result.content).toMatch(/\/SelF1 18 Tf\s+1 0 0 -1 9\.5 18 Tm\s+<000B> Tj/);
    const font = fontsOf(result.resources)?.SelF1;
    if (font?.kind !== 'embedded') throw new Error('missing embedded font');
    expect(font.toUnicode).toContainEqual([10, 'ab']);
    expect(font.toUnicode).not.toContainEqual([11, 'ab']);
    expect(font.widths.map(([id]) => id)).toEqual([10, 11]);
    expect(
      await textPdf(
        layout,
        glyphs.map((glyph) => vector(glyph.glyphId, 'lora', 0, 2)),
        {
          ...OPTIONS,
          selectable: { embed: () => ({ bytes, format: 'truetype' }) },
          transform: { a: 1, b: 0, c: 0, d: -1, e: 3, f: 90 },
        },
      ),
    ).toEqual(result);
  });

  it('shares Helvetica across unembedded faces, escapes WinAnsi, and preserves exact ActualText', async () => {
    const bytes = acceptanceFont('eb-garamond').bytes;
    const source = 'A(\\)😀';
    const glyphs = [
      { glyphId: 1, index: 0, end: 1, x: 1, y: 18, run: 0 },
      { glyphId: 2, index: 1, end: 2, x: 8, y: 18, run: 1 },
      { glyphId: 6, index: 1, end: 2, x: 12, y: 18, run: 1 },
      { glyphId: 3, index: 2, end: 3, x: 15, y: 18, run: 2 },
      { glyphId: 4, index: 3, end: 4, x: 22, y: 18, run: 1 },
      { glyphId: 5, index: 4, end: 6, x: 29, y: 18, run: 2 },
    ];
    const runs: TextLayout['runs'] = [
      { faceId: 'embedded', fontSize: 18, color: 'ink' },
      { faceId: 'unavailable-a', fontSize: 22, color: 'ink' },
      { faceId: 'unavailable-b', fontSize: 22, color: 'ink' },
    ];
    const layout = handLayout(source, glyphs, runs);
    const result = await textPdf(
      layout,
      glyphs.map((glyph) =>
        vector(glyph.glyphId, runs[glyph.run]?.faceId ?? '', glyph.index, glyph.end),
      ),
      {
        ...OPTIONS,
        selectable: {
          embed: (id) => (id === 'embedded' ? { bytes, format: 'truetype' } : undefined),
        },
      },
    );
    expect(
      Object.values(fontsOf(result.resources) ?? {}).filter((font) => font.kind === 'standard'),
    ).toHaveLength(1);
    expect(
      Object.values(fontsOf(result.resources) ?? {}).filter((font) => font.kind === 'embedded'),
    ).toHaveLength(1);
    expect(result.content).toContain('(\\() Tj');
    expect(result.content).toMatch(/\/SelF\d+ 22 Tf\s+1 0 0 -1 8 18 Tm\s+\(\\\(\) Tj/);
    expect(result.content).toContain('(\\\\) Tj');
    expect(result.content).toContain('(\\)) Tj');
    expect(result.content).toContain('(?) Tj');
    expect(result.content).toContain(`/ActualText ${actualText('😀')}`);
    expect(result.warnings.join(' ')).toMatch(
      /unavailable-a[\s\S]*not embedded|not embedded[\s\S]*unavailable-a/i,
    );
    expect(result.warnings.join(' ')).toContain('unavailable-b');
    const noEmbed = await textPdf(layout, [], { ...OPTIONS, selectable: {} });
    expect(
      Object.values(fontsOf(noEmbed.resources) ?? {}).filter((font) => font.kind === 'standard'),
    ).toHaveLength(1);
    expect(noEmbed.warnings.join(' ')).toContain('embedded');
  });
});

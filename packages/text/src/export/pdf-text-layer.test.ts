// The PDF text layer's edges: WinAnsi's extra characters, a face id with no
// letters, a glyph without a run or a glyph id, a glyph id that starts two clusters.
import { describe, expect, it } from 'vitest';

import type { TextLayout } from '../layout/text-layout.js';
import { acceptanceFont } from '../shaping/__fixtures__/shaping-fonts.js';

import { pdfTextLayer, winAnsiLiteral } from './pdf-text-layer.js';

/**
 * A one-line layout of hand-placed glyphs.
 *
 * @param text - The text.
 * @param glyphs - Each glyph's id, cluster and run.
 * @returns The layout.
 */
function layout(
  text: string,
  glyphs: readonly { glyphId: number | null; index: number; end: number; run: number }[],
): TextLayout {
  return {
    text,
    runs: [{ faceId: '--', fontSize: 10, color: 'ink' }],
    glyphs: glyphs.map((glyph, at) => ({
      ...glyph,
      codepoint: 65,
      level: 0,
      line: 0,
      x: at * 5,
      y: 10,
      advance: 5,
    })),
    lines: [],
    width: 20,
    height: 10,
  };
}

describe('the PDF text layer edges', () => {
  it('writes WinAnsi’s extra characters as their bytes and Latin-1 as itself', () => {
    expect(winAnsiLiteral('€é…')).toBe(`(${String.fromCharCode(0x80, 0xe9, 0x85)})`);
  });

  it('names a face with no letters, skips unshaped glyphs, and keeps a glyph’s first text', () => {
    const { bytes } = acceptanceFont('eb-garamond');
    const result = pdfTextLayer(
      layout('abc', [
        { glyphId: 5, index: 0, end: 1, run: 0 },
        { glyphId: null, index: 0, end: 1, run: 0 },
        { glyphId: 5, index: 1, end: 2, run: 0 },
        { glyphId: 6, index: 2, end: 3, run: 7 },
      ]),
      { embed: () => ({ bytes, format: 'truetype' }) },
      'P',
    );
    const embedded = result.fonts.PF1;
    expect(embedded).toMatchObject({ kind: 'embedded', baseFont: 'EmbeddedFont' });
    if (embedded?.kind !== 'embedded') throw new Error('expected an embedded font');
    // The first cluster has an unshaped glyph, so it is shown in Helvetica; glyph 5 starts the
    // second cluster.
    expect(embedded.toUnicode).toEqual([[5, 'b']]);
    expect(result.ops.filter((op) => op.endsWith(' Tj'))).toHaveLength(3);
    // The glyph whose run is missing falls back to Helvetica at size 0.
    expect(result.ops).toContain('/PF2 0 Tf');
    expect(result.fonts.PF2).toEqual({ kind: 'standard', baseFont: 'Helvetica' });
  });
  // Copying keeps a hard line break the layout draws no glyph for, and a
  // character before the first glyph.
  it('carries text no glyph draws in the neighbouring cluster’s ActualText', () => {
    const result = pdfTextLayer(
      layout('\tab\ncd', [
        { glyphId: 1, index: 1, end: 2, run: 0 },
        { glyphId: 2, index: 2, end: 3, run: 0 },
        { glyphId: 3, index: 4, end: 5, run: 0 },
        { glyphId: 4, index: 5, end: 6, run: 0 },
      ]),
      {},
      'L',
    );
    const actual = result.ops.filter((op) => op.startsWith('/Span'));
    expect(actual).toEqual([
      '/Span << /ActualText <FEFF00090061> >> BDC',
      '/Span << /ActualText <FEFF0062000A> >> BDC',
      '/Span << /ActualText <FEFF0063> >> BDC',
      '/Span << /ActualText <FEFF0064> >> BDC',
    ]);
    // The shown text is the cluster's own, without the line break.
    expect(result.ops).toContain('(b) Tj');
  });
});

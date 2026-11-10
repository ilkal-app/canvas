import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const CORPUS = new URL('../__fixtures__/format-corpus/', import.meta.url);
const reference = JSON.parse(
  readFileSync(new URL('corpus-sans-variable.reference.json', CORPUS), 'utf8'),
) as { at: Record<string, { glyphs: Record<string, { glyphId: number; advance: number }> }> };

describe('HarfBuzz variable font metrics', () => {
  it.each([400, 550, 700])('matches fontTools for A at wght %i', async (weight) => {
    const hb = await import('harfbuzzjs');
    const bytes = new Uint8Array(readFileSync(new URL('corpus-sans-variable.ttf', CORPUS)));
    const face = new hb.Face(new hb.Blob(bytes.slice().buffer));
    const font = new hb.Font(face);
    font.setVariations([new hb.Variation('wght', weight)]);
    const expected = reference.at[String(weight)]?.glyphs.A;
    expect(expected).toBeDefined();
    const glyphId = font.nominalGlyph('A'.codePointAt(0) ?? 65);
    expect(glyphId).toBe(expected?.glyphId);
    expect(font.glyphHAdvance(glyphId ?? 0)).toBe(expected?.advance);
  });
});

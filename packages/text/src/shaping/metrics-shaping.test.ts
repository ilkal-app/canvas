// Shaping from a face's metrics alone, as HarfBuzz shapes a face whose only
// positioning is pair kerning, for the CJK faces a server measures from a table.
import { describe, expect, it } from 'vitest';

import { shapeWithMetrics, type TableFontMetrics } from './metrics-shaping.js';

const ASTRAL = 0x20000;

const TABLE: TableFontMetrics = {
  face: { family: 'Table Sans', weight: 400, isItalic: false },
  ascent: 0.88,
  descent: 0.12,
  missingAdvance: 0.5,
  advances: [
    [0x41, 0.6],
    [0x2026, 1],
    [0x2014, 1],
    [0x3001, 1],
    [0x3042, 1],
    [0x3099, 0],
    [ASTRAL, 1],
  ],
  kerning: [[0x3042, 0x2014, -0.02]],
  ligatures: [
    [[0x2014, 0x2014], 1.676],
    [[0x3001, ASTRAL], 1.5],
  ],
  isolatedMarks: [[0x3099, 1]],
  latinScriptAdvances: [[0x2026, 1.059]],
};

/**
 * Each glyph's cluster and advance.
 *
 * @param text - The text.
 * @param direction - The direction, left to right when absent.
 * @returns `cluster:advance` per glyph, advances in thousandths of an em.
 */
function shaped(text: string, direction?: 'ltr' | 'rtl'): string[] {
  return shapeWithMetrics(TABLE, text, 0, text.length, direction).glyphs.map(
    ({ cluster, advance }) => `${String(cluster)}:${String(Math.round(advance * 1000))}`,
  );
}

describe('shapeWithMetrics', () => {
  it('sets a lone mark at its own spacing, and an unlisted lone mark at its advance', () => {
    expect(shaped('゙あ')).toEqual(['0:1000', '1:1000']);
    expect(shapeWithMetrics(TABLE, '́', 0, 1).glyphs).toMatchObject([{ glyphId: 0, advance: 0.5 }]);
  });

  it('draws a ligature as one glyph, kerned against the glyph before it', () => {
    expect(shaped('あ——')).toEqual(['0:980', '1:1676']);
  });

  it('matches a ligature ending in an astral character, and kerns after it by that character', () => {
    expect(shaped('、\u{20000}あ')).toEqual(['0:1500', '3:1000']);
  });

  it('takes the Latin advances in a stretch HarfBuzz shapes as Latin, and not otherwise', () => {
    expect(shaped('…A')).toEqual(['0:1059', '1:600']);
    expect(shaped('…あ')).toEqual(['0:1000', '1:1000']);
  });

  it('gives right-to-left glyphs in visual order', () => {
    expect(shaped('あA', 'rtl')).toEqual(['1:600', '0:1000']);
  });
});

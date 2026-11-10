import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import { missingGlyphs, type FontMetrics } from '@canvas/text';

const STYLE: TextStyle = {
  fontFamily: 'Own',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

/**
 * Minimal deterministic metrics whose advance keys are its exact cmap.
 *
 * @param family - Face family.
 * @param characters - Scalars in its cmap.
 * @returns Metrics with exact coverage.
 */
function metrics(family: string, characters: string): FontMetrics {
  return {
    face: { family, weight: 400, isItalic: false },
    ascent: 0.8,
    descent: 0.2,
    missingAdvance: 0.5,
    advances: [...new Set(Array.from(characters, (character) => character.codePointAt(0) ?? 0))]
      .sort((first, second) => first - second)
      .map((point) => [point, 0.5]),
    kerning: [],
  };
}

/**
 * One style run over all UTF-16 units.
 *
 * @param text - Run text.
 * @returns A single run.
 */
function whole(text: string): StyleRun[] {
  return [{ length: text.length, style: STYLE }];
}

describe('missingGlyphs per chosen cluster face', () => {
  it('reports the uncovered mark when the fallback can draw only the base', () => {
    const text = 'a\u0301';
    expect(
      missingGlyphs(text, whole(text), [metrics('Own', ''), metrics('Noto Sans Math', 'a')]),
    ).toEqual([{ codePoint: 0x301, index: 1 }]);
  });

  it('reports nothing when one fallback covers a whole cluster', () => {
    const text = 'a\u0301';
    expect(
      missingGlyphs(text, whole(text), [metrics('Own', 'a'), metrics('Noto Sans Math', text)]),
    ).toEqual([]);
  });

  it('ignores default-ignorables absent from a face cmap', () => {
    const text = '\u2764\ufe0f \u{1f468}\u200d\u{1f469} \u034f\u200c\u{e0061}\u{e007f}';
    const drawn = '\u2764 \u{1f468}\u{1f469}';
    expect(missingGlyphs(text, whole(text), [metrics('Own', drawn)])).toEqual([]);
  });

  it('never reports tab, LF or CR and keeps UTF-16 indices for missing drawn scalars', () => {
    const text = '\u{1f600}\t\n\r\u{1f601}';
    expect(missingGlyphs(text, whole(text), [metrics('Own', '')])).toEqual([
      { codePoint: 0x1f600, index: 0 },
      { codePoint: 0x1f601, index: 5 },
    ]);
  });
});

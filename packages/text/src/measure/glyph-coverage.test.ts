import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { symbolCoverageMetrics } from '../bundled/coverage-fonts.js';

import { coverageMeasureRuns, missingGlyphs } from './glyph-coverage.js';
import { measureText, measuringFontsFor } from './measure-text.js';

const LIBERATION: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

/**
 * One run over a whole text.
 *
 * @param text - The text.
 * @param style - The style.
 * @returns The runs.
 */
function whole(text: string, style: TextStyle = LIBERATION): StyleRun[] {
  return [{ length: text.length, style }];
}

/**
 * The fonts a set of texts is measured with.
 *
 * @param runs - The runs.
 * @returns The fonts.
 */
function fontsFor(runs: readonly StyleRun[]) {
  return measuringFontsFor([runs]).fonts;
}

describe('missingGlyphs', () => {
  it('reports nothing when the text’s font or a symbol face has every character', () => {
    const text = 'More ⋯ done ✓ → ←\nnext';
    expect(missingGlyphs(text, whole(text), fontsFor(whole(text)))).toEqual([]);
  });

  it('reports a character no available face has, with its code point and UTF-16 index', () => {
    // The emoji face draws the emoji; the private-use character has no face.
    const text = 'Hi 😀 and \u{E000}';
    expect(missingGlyphs(text, whole(text), fontsFor(whole(text)))).toEqual([
      { codePoint: 0xe000, index: 10 },
    ]);
  });

  it('checks each run against its own face', () => {
    const inter: TextStyle = { ...LIBERATION, fontFamily: 'Inter' };
    const text = '✓✓';
    const runs: StyleRun[] = [
      { length: 1, style: inter },
      { length: 1, style: LIBERATION },
    ];
    // Inter has ✓; Liberation Sans does not, but Noto Sans Symbols 2 does.
    expect(missingGlyphs(text, runs, fontsFor(runs))).toEqual([]);
    expect(
      missingGlyphs(
        text,
        runs,
        fontsFor(runs).filter((font) => !symbolCoverageMetrics().includes(font)),
      ),
    ).toEqual([{ codePoint: 0x2713, index: 1 }]);
  });
});

describe('coverageMeasureRuns', () => {
  it('moves characters the run’s face lacks into the symbol face that has them', () => {
    const text = 'a⋯b✓';
    const runs = coverageMeasureRuns(text, whole(text), fontsFor(whole(text)));
    expect(runs.map(({ length, style }) => [length, style.fontFamily])).toEqual([
      [1, 'Liberation Sans'],
      [1, 'Noto Sans Math'],
      [1, 'Liberation Sans'],
      [1, 'Noto Sans Math'],
    ]);
  });

  it('measures a symbol with its fallback face, not as the missing glyph', () => {
    const fonts = fontsFor(whole('⋯'));
    const withFallback = measureText('⋯⋯⋯⋯', whole('⋯⋯⋯⋯'), null, fonts);
    const missing = measureText(
      '⋯⋯⋯⋯',
      whole('⋯⋯⋯⋯'),
      null,
      fonts.filter((font) => !symbolCoverageMetrics().includes(font)),
    );
    expect(withFallback.width).not.toBeCloseTo(missing.width, 3);
    expect(withFallback.width).toBeGreaterThan(0);
  });
});

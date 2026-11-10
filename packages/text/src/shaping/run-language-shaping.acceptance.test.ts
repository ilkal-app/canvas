import { describe, expect, it, vi } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import type { GlyphMeasurer } from '../layout/glyph-measurer.js';
import { layoutText } from '../layout/layout-text.js';

import { acceptanceFont } from './__fixtures__/shaping-fonts.js';
import { loadShaper, shapeText } from './shaper.js';

const STYLE: TextStyle = {
  fontFamily: 'Test',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

describe('language reaches shaping segments', () => {
  it('sets the HarfBuzz buffer language for an explicitly tagged stretch', async () => {
    const shaper = await loadShaper();
    const face = shaper.face('language-acceptance', acceptanceFont('dm-sans').bytes);
    const buffer = (shaper as unknown as { buffer: { setLanguage(value: string): void } }).buffer;
    const setLanguage = vi.spyOn(buffer, 'setLanguage');
    try {
      shapeText(shaper, face, 'abc', 0, 3, 'ltr', 'ja');
      expect(setLanguage).toHaveBeenCalledWith('ja');
    } finally {
      setLanguage.mockRestore();
    }
  });

  it('cuts adjacent runs differing only by lang and passes each tag to the shaping measurer', () => {
    // A shape spy at the GlyphMeasurer boundary observes segment splitting and language
    // forwarding without relying on font-specific glyph substitutions.
    const shape = vi.fn(
      (
        faceId: string,
        text: string,
        start: number,
        end: number,
        direction?: 'ltr' | 'rtl',
        // Variable-font coordinates come before the language.
        variations?: Readonly<Record<string, number>>,
        language?: string,
      ) => {
        if (language === undefined) throw new Error('Missing shaping language');
        return {
          direction: direction ?? ('ltr' as const),
          glyphs: Array.from(text.slice(start, end), (character, index) => ({
            glyphId: character.codePointAt(0) ?? 0,
            cluster: start + index,
            advance: 0.5,
            xOffset: 0,
            yOffset: 0,
            isUnsafeToBreak: false,
          })),
        };
      },
    );
    const measurer: GlyphMeasurer = {
      faceIdOf: () => 'Test',
      advance: () => 0.5,
      kerning: () => 0,
      lineMetrics: () => ({ ascent: 0.8, descent: 0.2 }),
      shape,
    };
    const runs: StyleRun[] = [
      { length: 2, style: { ...STYLE, lang: 'en' } },
      { length: 2, style: { ...STYLE, lang: 'ja' } },
    ];
    layoutText('abcd', runs, null, measurer);
    expect(
      shape.mock.calls.map(([, , start, end, , , language]) => [start, end, language]),
    ).toEqual([
      [0, 2, 'en'],
      [2, 4, 'ja'],
    ]);
  });
});

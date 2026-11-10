import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { createFontMetrics } from '../font/font-metrics.js';
import { parseFont } from '../font/parse-font.js';
import { createMetricsMeasurer } from '../layout/glyph-measurer.js';
import { layoutText } from '../layout/layout-text.js';

import { measuringFontsFor, measureText } from './measure-text.js';

const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 24,
  color: 'ink',
  weight: 400,
  italic: false,
};

const runsOf = (text: string, style: TextStyle = STYLE): StyleRun[] => [
  { length: text.length, style },
];

describe('measuringFontsFor', () => {
  it('loads the default family first, then each bundled family the runs name, once, then the symbol faces', () => {
    const { fonts, unknownFamilies } = measuringFontsFor([
      runsOf('a', { ...STYLE, fontFamily: 'Inter' }),
      runsOf('b', { ...STYLE, fontFamily: 'Inter', weight: 700 }),
      runsOf('c'),
    ]);
    expect(fonts.map(({ face }) => `${face.family} ${String(face.weight)}`)).toEqual([
      'Liberation Sans 400',
      'Liberation Sans 700',
      'Liberation Sans 400',
      'Liberation Sans 700',
      'Inter 400',
      'Inter 700',
      'Inter 300',
      'Inter 400',
      'Inter 500',
      'Inter 600',
      'Inter 700',
      // The symbol faces a character its own font lacks falls back to.
      'Noto Sans Math 400',
      'Noto Sans Symbols 2 400',
      // And the emoji face, Noto Color Emoji since, regular only.
      'Noto Color Emoji 400',
    ]);
    expect(unknownFamilies).toEqual([]);
  });

  it('reports a family the app does not bundle, with the family measured in its place', () => {
    const { fonts, unknownFamilies } = measuringFontsFor([
      runsOf('a', { ...STYLE, fontFamily: 'Comic Sans MS' }),
      runsOf('b', { ...STYLE, fontFamily: 'Helvetica' }),
      runsOf('c', { ...STYLE, fontFamily: 'Comic Sans MS' }),
    ]);
    expect(unknownFamilies).toEqual([
      { family: 'Comic Sans MS', measuredWith: 'Caveat' },
      { family: 'Helvetica', measuredWith: 'Liberation Sans' },
    ]);
    expect(new Set(fonts.map(({ face }) => face.family))).toEqual(
      new Set([
        'Liberation Sans',
        'Caveat',
        'Noto Sans Math',
        'Noto Sans Symbols 2',
        'Noto Color Emoji',
      ]),
    );
  });
});

describe('measuringFontsFor and the nine weights', () => {
  it('reports each weight a bundled family lacks with the weight it is drawn in, once', () => {
    const openSans = { ...STYLE, fontFamily: 'Open Sans' };
    const { weightFallbacks } = measuringFontsFor([
      runsOf('a', { ...openSans, weight: 500 }),
      runsOf('b', { ...openSans, weight: 600, italic: true }),
      runsOf('c', { ...openSans, weight: 500 }),
      runsOf('d', { ...openSans, weight: 700 }),
      runsOf('e', { ...STYLE, fontFamily: 'Bebas Neue', weight: 700 }),
      runsOf('f', { ...STYLE, fontFamily: 'Comic Sans MS', weight: 500 }),
    ]);
    expect(weightFallbacks).toEqual([
      { family: 'Open Sans', weight: 500, isItalic: false, drawnWeight: 400 },
      { family: 'Open Sans', weight: 600, isItalic: true, drawnWeight: 700 },
      { family: 'Bebas Neue', weight: 700, isItalic: false, drawnWeight: 400 },
    ]);
  });

  it('reports a weight once per slant, each with the weight drawn in that slant', () => {
    const openSans = { ...STYLE, fontFamily: 'Open Sans', weight: 600 } as const;
    expect(
      measuringFontsFor([
        runsOf('a', openSans),
        runsOf('b', { ...openSans, italic: true }),
        runsOf('c', openSans),
      ]).weightFallbacks,
    ).toEqual([
      { family: 'Open Sans', weight: 600, isItalic: false, drawnWeight: 700 },
      { family: 'Open Sans', weight: 600, isItalic: true, drawnWeight: 700 },
    ]);
  });

  it('draws Geist, Inter and Roboto at 300, 500 and 600 upright in their own faces', () => {
    const runs = ['Geist', 'Inter', 'Roboto'].flatMap((fontFamily) =>
      ([300, 500, 600] as const).flatMap((weight) => [
        runsOf('a', { ...STYLE, fontFamily, weight }),
        runsOf('b', { ...STYLE, fontFamily, weight, italic: true }),
      ]),
    );
    // Upright faces exist; their italics still fall back to the nearest italic (400 or 700).
    expect(measuringFontsFor(runs).weightFallbacks.every(({ isItalic }) => isItalic)).toBe(true);
  });

  it('reports none when every weight is bundled', () => {
    expect(
      measuringFontsFor([runsOf('a'), runsOf('b', { ...STYLE, weight: 700 })]).weightFallbacks,
    ).toEqual([]);
  });
});

describe('measureText', () => {
  it('measures exactly as the layout over the font files does', () => {
    const { fonts } = measuringFontsFor([runsOf('')]);
    const fromFiles = loadBundledFaces().map(({ face, bytes }) =>
      createFontMetrics(face, parseFont(bytes)),
    );
    const text = 'AVATAR Typography\nwraps where the app wraps it';
    for (const wrapWidth of [null, 120, 300]) {
      const layout = layoutText(text, runsOf(text), wrapWidth, createMetricsMeasurer(fromFiles));
      expect(measureText(text, runsOf(text), wrapWidth, fonts)).toEqual({
        width: layout.width,
        height: layout.height,
        lineCount: layout.lines.length,
      });
    }
  });

  it('measures empty text as one line of its style', () => {
    const { fonts } = measuringFontsFor([runsOf('')]);
    const measured = measureText('', [{ length: 0, style: STYLE }], null, fonts);
    expect(measured).toEqual({ width: 0, height: 30, lineCount: 1 });
  });

  it('refuses to measure without fonts', () => {
    expect(() => measureText('a', runsOf('a'), null, [])).toThrow(RangeError);
  });
});

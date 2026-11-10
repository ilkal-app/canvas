/// <reference types="node" />
// The codepoints a bundled face shapes to more than one glyph, such as Montserrat's and
// Oswald's "Ǆ" (D and Ž) or Noto Sans Arabic's "آ" (alef and madda), so the engine gives each
// enough records (it counts them before any layout exists). Every face of every bundled family,
// the symbol faces and the Arabic coverage faces; every codepoint each maps, shaped alone and, in
// a face that joins (it maps the tatweel), in its initial, medial and final forms, with every
// Arabic mark on every Arabic letter. The table keeps the most glyphs any face adds for each.
// Regenerated with the metrics:
//
//   UPDATE_BUNDLED_METRICS=1 pnpm vitest run --project @canvas/text expanding-codepoints
//   pnpm exec prettier --write packages/text/src/bundled/expanding-glyphs.ts
import { readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { fontFaceId, type FontFaceKey } from '../font/font-face.js';
import { createFontMetrics } from '../font/font-metrics.js';
import { parseFont } from '../font/parse-font.js';
import { loadShaper, shapeText } from '../shaping/shaper.js';

import { expandedGlyphsOf } from './expanded-glyphs.js';
import { EXPANDING_GLYPHS } from './expanding-glyphs.js';
import { BUNDLED_FONT_FILES } from './font-files.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);

/** The Arabic coverage faces, which draw Arabic for every family (the app's script coverage). */
const ARABIC_COVERAGE_FILES = ([400, 700] as const).map((weight) => ({
  weight,
  path: `packages/app/assets/fonts/script-coverage/notosansarabic/${String(weight)}.ttf`,
}));

/** The tatweel, which joins on both sides: a face that maps it joins Arabic letters. */
const TATWEEL = '\u0640';

/** The positions a joining letter takes, as the text around it: initial, medial, final. */
const JOINING_CONTEXTS: readonly (readonly [before: string, after: string])[] = [
  ['', TATWEEL],
  [TATWEEL, TATWEEL],
  [TATWEEL, ''],
];

/**
 * Whether a codepoint is an Arabic letter or an Arabic combining mark.
 *
 * @param codepoint - The codepoint.
 * @returns Its kind, or undefined for neither.
 */
function arabicKindOf(codepoint: number): 'letter' | 'mark' | undefined {
  if ((codepoint >= 0x064b && codepoint <= 0x065f) || codepoint === 0x0670) return 'mark';
  if ((codepoint >= 0x0620 && codepoint <= 0x064a) || (codepoint >= 0x0671 && codepoint <= 0x06d3))
    return 'letter';
  return undefined;
}

/**
 * Every codepoint a bundled face shapes to more than one glyph, alone or in a joining context,
 * with the most glyphs any face gives it, in codepoint order.
 *
 * @returns The table.
 */
async function measuredExpansions(): Promise<[codepoint: number, glyphs: number][]> {
  const shaper = await loadShaper();
  const most = new Map<number, number>();
  const note = (codepoint: number, glyphs: number): void => {
    if (glyphs > 1) most.set(codepoint, Math.max(most.get(codepoint) ?? 0, glyphs));
  };
  const files: { readonly key: FontFaceKey; readonly path: string }[] = [
    ...BUNDLED_FONT_FILES.map(([family, weight, isItalic, path]) => ({
      key: { family, weight, isItalic },
      path,
    })),
    ...ARABIC_COVERAGE_FILES.map(({ weight, path }) => ({
      key: { family: 'Noto Sans Arabic', weight, isItalic: false },
      path,
    })),
  ];
  for (const { key, path } of files) {
    const bytes = readFileSync(new URL(path, REPO_ROOT));
    const face = shaper.face(`expanding:${fontFaceId(key)}`, bytes);
    const count = (text: string): number =>
      shapeText(shaper, face, text, 0, text.length).glyphs.length;
    const codepoints = createFontMetrics(key, parseFont(bytes)).advances.map(
      ([codepoint]) => codepoint,
    );
    const isJoining = codepoints.includes(TATWEEL.codePointAt(0) ?? 0);
    for (const codepoint of codepoints) {
      const text = String.fromCodePoint(codepoint);
      note(codepoint, count(text));
      if (!isJoining) continue;
      // The glyphs it adds in each position: the context's own glyphs taken away.
      for (const [before, after] of JOINING_CONTEXTS)
        note(codepoint, count(before + text + after) - count(before + after));
    }
    if (!isJoining) continue;
    const letters = codepoints.filter((codepoint) => arabicKindOf(codepoint) === 'letter');
    const marks = codepoints.filter((codepoint) => arabicKindOf(codepoint) === 'mark');
    for (const mark of marks) {
      for (const letter of letters) {
        const base = String.fromCodePoint(letter);
        for (const [before, after] of [['', ''] as const, ...JOINING_CONTEXTS]) {
          const withMark = count(before + base + String.fromCodePoint(mark) + after);
          note(mark, withMark - count(before + base + after));
        }
      }
    }
  }
  return [...most].sort(([left], [right]) => left - right);
}

const measured = await measuredExpansions();

if (process.env.UPDATE_BUNDLED_METRICS === '1') {
  writeFileSync(
    new URL('./expanding-glyphs.ts', import.meta.url),
    [
      '// Generated by src/bundled/expanding-codepoints.test.ts; do not edit.',
      '',
      '/**',
      ' * The codepoints a bundled face shapes to more than one glyph, alone or in a joining',
      ' * context, with the most glyphs any face adds for each, in codepoint order.',
      ' */',
      'export const EXPANDING_GLYPHS: readonly (readonly [codepoint: number, glyphs: number])[] = [',
      ...measured.map(
        ([codepoint, glyphs]) => `  [0x${codepoint.toString(16)}, ${String(glyphs)}],`,
      ),
      '];',
      '',
    ].join('\n'),
  );
}

describe('EXPANDING_GLYPHS', () => {
  it('answers a listed codepoint with its glyphs and any other with one', () => {
    expect(expandedGlyphsOf(0x1c4)).toBe(2);
    expect(expandedGlyphsOf(0x61)).toBe(1);
  });

  it('lists every codepoint a bundled face shapes to more than one glyph, alone or joined', () => {
    expect(EXPANDING_GLYPHS).toEqual(measured);
  });
});

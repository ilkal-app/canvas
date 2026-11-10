/// <reference types="node" />
// The characters a library's faces cannot draw, per grapheme cluster as the engine
// sets them (the render service's missing-glyph report).
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { BUNDLED_FAMILY, loadBundledFaces } from '../__fixtures__/bundled-fonts.js';

import { missingCoverageGlyphs } from './coverage-runs.js';
import { FontLibrary } from './font-library.js';

const STYLE: TextStyle = {
  fontFamily: BUNDLED_FAMILY,
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

const runsOf = (text: string, style: TextStyle = STYLE): StyleRun[] => [
  { length: text.length, style },
];

/**
 * The bundled faces, with Noto Sans Arabic and Noto Sans Thai loaded as coverage.
 *
 * @returns The library.
 */
function library(): FontLibrary {
  const fonts = new FontLibrary();
  for (const { face, bytes } of loadBundledFaces()) fonts.addFace(face, bytes);
  for (const [family, slug] of [
    ['Noto Sans Arabic', 'notosansarabic'],
    ['Noto Sans Thai', 'notosansthai'],
  ] as const) {
    const bytes = readFileSync(
      new URL(`../../../../app/assets/fonts/script-coverage/${slug}/400.ttf`, import.meta.url),
    );
    fonts.addFace(
      { family, weight: 400, isItalic: false },
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  }
  return fonts;
}

describe('missingCoverageGlyphs', () => {
  it('reports nothing for text the loaded faces draw', () => {
    const text = 'Hi مرحبا สวัสดี';
    expect(missingCoverageGlyphs(text, runsOf(text), library())).toEqual([]);
  });

  it('reports a character no face has, with its UTF-16 index', () => {
    const text = 'a\u{10FFFD}b';
    expect(missingCoverageGlyphs(text, runsOf(text), library())).toEqual([
      { codePoint: 0x10fffd, index: 1 },
    ]);
  });

  it('reports per cluster: a Thai mark on an Arabic letter is set in the Arabic face', () => {
    const text = 'بั';
    expect(missingCoverageGlyphs(text, runsOf(text), library())).toEqual([
      { codePoint: 0x0e31, index: 1 },
    ]);
  });

  it('falls back from a run whose face the library lacks', () => {
    const text = 'م';
    const runs = runsOf(text, { ...STYLE, fontFamily: 'Nowhere Sans' });
    expect(missingCoverageGlyphs(text, runs, library())).toEqual([]);
  });
});

/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import { coverageMeasureRuns } from '@canvas/text';

import { BUNDLED_FAMILY, loadBundledFaces } from '../__fixtures__/bundled-fonts.js';

import { coverageRuns } from './coverage-runs.js';
import { FontLibrary } from './font-library.js';

const STYLE: TextStyle = {
  fontFamily: BUNDLED_FAMILY,
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

const COVERAGE_FILES = [
  ['Noto Sans Devanagari', 'notosansdevanagari'],
  ['Noto Sans Thai', 'notosansthai'],
  ['Noto Sans Hebrew', 'notosanshebrew'],
  ['Noto Sans Arabic', 'notosansarabic'],
  ['Noto Sans SC', 'notosanssc'],
  ['Noto Sans Symbols 2', 'notosanssymbols2'],
] as const;

/**
 * Loads identical physical faces for engine and metric coverage decisions.
 *
 * @returns The loaded library.
 */
function libraryWithCoverage(): FontLibrary {
  const library = new FontLibrary();
  for (const { face, bytes } of loadBundledFaces()) library.addFace(face, bytes);
  for (const [family, slug] of COVERAGE_FILES) {
    const bytes = readFileSync(
      new URL(`../../../../app/assets/fonts/script-coverage/${slug}/400.ttf`, import.meta.url),
    );
    library.addFace(
      { family, weight: 400, isItalic: false },
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  }
  return library;
}

describe('engine and measurement coverage parity', () => {
  it('chooses the same faces and UTF-16 run lengths over the shaping corpus', () => {
    const library = libraryWithCoverage();
    const fonts = library.faces
      .map((face) => library.resolve(face)?.metrics)
      .filter((font) => font !== undefined);
    const corpus = [
      'a\u20dd',
      '\u0915\u094d\u0937',
      '\u0e01\u0e49',
      '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}',
      '\u{1f1fa}\u{1f1f8}',
      '\u2764\ufe0f',
      '\u05d0\u05b7',
      '\u0639\u064e',
      'abc\u4f60\u597dxyz',
      '\u0e01 123 \u0e02',
    ];
    for (const text of corpus) {
      const runs: StyleRun[] = [{ length: text.length, style: STYLE }];
      const engine = coverageRuns(text, runs, library);
      const measured = coverageMeasureRuns(text, runs, fonts);
      expect(measured, text).toEqual(engine);
      expect(
        engine.reduce((length, run) => length + run.length, 0),
        text,
      ).toBe(text.length);
      let boundary = 0;
      const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
      const clusterEnds = new Set(
        [...segmenter.segment(text)].map(({ index, segment }) => index + segment.length),
      );
      for (const run of engine) {
        boundary += run.length;
        expect(clusterEnds.has(boundary), text).toBe(true);
      }
      expect(runs).toEqual([{ length: text.length, style: STYLE }]);
    }
  });
});

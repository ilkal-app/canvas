import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { FontLibrary, createLayoutJobRequest, layoutTextNow } from '@canvas/engine';
import {
  cjkSliceIdOf,
  cjkSliceOf,
  HAN_LANGUAGE_FAMILIES,
  scriptCoverageFamilies,
} from '@canvas/text';

import { COVERAGE_FONT_FAMILIES } from './coverage-fonts.js';
import { DEFAULT_TEXT_STYLE, FONT_FACE_SOURCES } from './font-catalogue.js';

it('bundles actual script glyphs, not the providers Latin-only subsets', () => {
  const samples = [
    '中',
    'ع',
    'न',
    'ש',
    'ไ',
    'ব',
    'த',
    'త',
    'ಕ',
    'മ',
    'ქ',
    'Ա',
    'ሀ',
    'ក',
    'က',
    'අ',
    'ກ',
    'あ',
    '한',
  ];
  // Each sample's coverage family; a CJK family's slice of it. The fallback faces
  // are checked against their scripts in @canvas/text (script/fallback-faces.test.ts).
  for (const sample of samples) {
    const codepoint = sample.codePointAt(0) ?? 0;
    const [family] = scriptCoverageFamilies(sample);
    const entry = COVERAGE_FONT_FAMILIES.find((candidate) => candidate.family === family);
    const source = entry?.faces.find(
      (face) =>
        !HAN_LANGUAGE_FAMILIES.includes(face.family) ||
        cjkSliceIdOf(face) === cjkSliceOf(face.family, codepoint),
    );
    if (!source) throw new Error(`No coverage face for ${sample}`);
    const font = new FontLibrary();
    const bytes = readFileSync(fileURLToPath(source.url));
    const face = font.addFace(source, new Uint8Array(bytes).buffer);
    expect(face.font.glyphIdOf(codepoint), source.family).toBeGreaterThan(0);
  }
});

it('swaps only unsupported glyphs to loaded coverage, retaining source text and style runs', () => {
  const fonts = new FontLibrary();
  const primary = FONT_FACE_SOURCES[0];
  const hebrew = COVERAGE_FONT_FAMILIES.find((entry) => entry.family === 'Noto Sans Hebrew')
    ?.faces[0];
  if (!primary || !hebrew) throw new Error('Missing fixture');
  fonts.addFace(primary, new Uint8Array(readFileSync(fileURLToPath(primary.url))).buffer);
  const input = {
    objectId: 'mixed',
    text: 'Hi ש',
    runs: [{ length: 4, style: DEFAULT_TEXT_STYLE }],
    maxWidth: null,
    align: 'left',
  } as const;
  const before = createLayoutJobRequest(input, fonts);
  expect(before.runs).toEqual(input.runs);
  fonts.addFace(hebrew, new Uint8Array(readFileSync(fileURLToPath(hebrew.url))).buffer);
  const after = createLayoutJobRequest(input, fonts);
  expect(after.runs.map((run) => [run.length, run.style.fontFamily])).toEqual([
    [3, 'Liberation Sans'],
    [1, 'Noto Sans Hebrew'],
  ]);
  expect(input.runs).toEqual([{ length: 4, style: DEFAULT_TEXT_STYLE }]);
  expect(layoutTextNow(after).width).toBeGreaterThan(0);
});

// Acceptance (Claude): every script the coverage table names has a bundled Noto family
// with a regular and a bold static TrueType face; coverage families are hidden from the picker;
// a bold run keeps its weight when its missing glyphs are drawn from coverage; and the layout's
// substitution never changes the stored runs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createLayoutJobRequest, FontLibrary, type FontFaceSource } from '@canvas/engine';
import type { StyleRun } from '@canvas/schema';
import { SCRIPT_COVERAGE_FAMILIES, SYMBOL_COVERAGE_FAMILIES } from '@canvas/text';

import { COVERAGE_FONT_FAMILIES } from './coverage-fonts.js';
import { DEFAULT_TEXT_STYLE, FONT_FACE_SOURCES, FONT_FAMILIES } from './font-catalogue.js';
import { coverageFamilies } from './script-coverage.js';

/** One character per script the table covers, with the family it should name. */
const SCRIPT_SAMPLES: readonly (readonly [string, string])[] = [
  ['中', 'Noto Sans SC'],
  ['あ', 'Noto Sans JP'],
  ['한', 'Noto Sans KR'],
  ['ع', 'Noto Sans Arabic'],
  ['न', 'Noto Sans Devanagari'],
  ['ש', 'Noto Sans Hebrew'],
  ['ไ', 'Noto Sans Thai'],
  ['ব', 'Noto Sans Bengali'],
  ['த', 'Noto Sans Tamil'],
  ['త', 'Noto Sans Telugu'],
  ['ಕ', 'Noto Sans Kannada'],
  ['മ', 'Noto Sans Malayalam'],
  ['ქ', 'Noto Sans Georgian'],
  ['Ա', 'Noto Sans Armenian'],
  ['ሀ', 'Noto Sans Ethiopic'],
  ['ក', 'Noto Sans Khmer'],
  ['က', 'Noto Sans Myanmar'],
  ['අ', 'Noto Sans Sinhala'],
  ['ກ', 'Noto Sans Lao'],
];

/**
 * Reads a bundled face's bytes.
 *
 * @param face - The face.
 * @returns Its file.
 */
function bytesOf(face: FontFaceSource): ArrayBuffer {
  const bytes = readFileSync(fileURLToPath(face.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Whether a file is a static TrueType font (sfnt 1.0 with `glyf`, without `fvar` or `CFF `).
 *
 * @param bytes - The file.
 * @returns True for a static TrueType file.
 */
function isStaticTrueType(bytes: ArrayBuffer): boolean {
  const view = new DataView(bytes);
  if (bytes.byteLength < 12 || view.getUint32(0) !== 0x00010000) return false;
  const count = view.getUint16(4);
  const tags = Array.from({ length: count }, (unused, index) =>
    String.fromCharCode(...new Uint8Array(bytes, 12 + index * 16, 4)),
  );
  return tags.includes('glyf') && !tags.includes('fvar') && !tags.includes('CFF ');
}

describe('Noto script coverage', () => {
  it('names a bundled family with regular and bold static faces for every covered script', () => {
    for (const [sample, family] of SCRIPT_SAMPLES) {
      expect(coverageFamilies(sample), sample).toEqual([family]);
      const entry = COVERAGE_FONT_FAMILIES.find((candidate) => candidate.family === family);
      expect(entry, family).toBeDefined();
      // Regular and bold; a CJK family has them as slices, each a face of its own.
      expect(
        [
          ...new Set(
            entry?.faces.map(({ weight, isItalic }) => `${String(weight)}${isItalic ? 'i' : ''}`),
          ),
        ].sort(),
        family,
      ).toEqual(['400', '700']);
      for (const face of entry?.faces ?? []) {
        expect(isStaticTrueType(bytesOf(face)), face.url).toBe(true);
      }
    }
    // The script families, then the symbol faces (checked in symbol-coverage-bundle);
    // then a face for every script Noto covers, and Han's TC and HK.
    const bundled = COVERAGE_FONT_FAMILIES.map(({ family }) => family);
    const expected = [...SCRIPT_COVERAGE_FAMILIES, ...SYMBOL_COVERAGE_FAMILIES];
    expect(bundled).toHaveLength(expected.length);
    expect(new Set(bundled)).toEqual(new Set(expected));
  });

  it('keeps coverage families out of the picker and off the startup list', () => {
    const visible = new Set(FONT_FAMILIES.map(({ family }) => family));
    for (const { family } of COVERAGE_FONT_FAMILIES) expect(visible.has(family)).toBe(false);
    for (const face of FONT_FACE_SOURCES) expect(face.family.startsWith('Noto')).toBe(false);
  });

  it('draws a bold run’s missing glyphs with the bold coverage face, leaving the stored runs as they were', () => {
    const fonts = new FontLibrary();
    for (const face of FONT_FACE_SOURCES) fonts.addFace(face, bytesOf(face));
    const hebrew = COVERAGE_FONT_FAMILIES.find((entry) => entry.family === 'Noto Sans Hebrew');
    if (hebrew === undefined) throw new Error('no Hebrew coverage');
    for (const face of hebrew.faces) fonts.addFace(face, bytesOf(face));

    const runs: readonly StyleRun[] = [
      { length: 3, style: { ...DEFAULT_TEXT_STYLE, weight: 700 } },
      { length: 1, style: { ...DEFAULT_TEXT_STYLE, weight: 400 } },
    ];
    const snapshot = structuredClone(runs);
    const request = createLayoutJobRequest(
      { objectId: 'mixed', text: 'Hi ש', runs, maxWidth: null, align: 'left' },
      fonts,
    );
    expect(runs).toEqual(snapshot);
    expect(request.runs.map((run) => [run.length, run.style.fontFamily, run.style.weight])).toEqual(
      [
        [3, 'Liberation Sans', 700],
        [1, 'Noto Sans Hebrew', 400],
      ],
    );

    const bold = createLayoutJobRequest(
      {
        objectId: 'bold',
        text: 'שלום',
        runs: [{ length: 4, style: { ...DEFAULT_TEXT_STYLE, weight: 700 } }],
        maxWidth: null,
        align: 'left',
      },
      fonts,
    );
    expect(bold.runs.map((run) => [run.length, run.style.fontFamily, run.style.weight])).toEqual([
      [4, 'Noto Sans Hebrew', 700],
    ]);
    expect(
      fonts.resolve({ family: 'Noto Sans Hebrew', weight: 700, isItalic: false })?.face,
    ).toMatchObject({ family: 'Noto Sans Hebrew', weight: 700 });
  });

  it('substitutes nothing while no coverage family is loaded: the same runs, by reference', () => {
    const fonts = new FontLibrary();
    for (const face of FONT_FACE_SOURCES) fonts.addFace(face, bytesOf(face));
    const runs: readonly StyleRun[] = [{ length: 4, style: DEFAULT_TEXT_STYLE }];
    const request = createLayoutJobRequest(
      { objectId: 'none', text: 'Hi ש', runs, maxWidth: null, align: 'left' },
      fonts,
    );
    expect(request.runs).toBe(runs);
  });
});

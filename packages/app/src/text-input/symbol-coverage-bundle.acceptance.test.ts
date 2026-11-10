// The symbol faces are bundled as static regular TrueType faces, hidden from the
// picker, requested only for text holding symbols, and draw the symbols a text's own font lacks
// (⋯ and ✓ in Liberation Sans, ⋯ in Inter) without changing the stored runs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createLayoutJobRequest, FontLibrary, type FontFaceSource } from '@canvas/engine';
import type { StyleRun } from '@canvas/schema';
import { SYMBOL_COVERAGE_FAMILIES } from '@canvas/text';

import { COVERAGE_FONT_FAMILIES } from './coverage-fonts.js';
import { DEFAULT_TEXT_STYLE, FONT_FACE_SOURCES, FONT_FAMILIES } from './font-catalogue.js';
import { coverageFamilies } from './script-coverage.js';

/**
 * A face's file.
 *
 * @param face - The face.
 * @returns Its bytes.
 */
function bytesOf(face: FontFaceSource): ArrayBuffer {
  const bytes = readFileSync(fileURLToPath(face.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe('symbol coverage', () => {
  it('bundles each symbol family as one static regular face, hidden from the picker', () => {
    const visible = new Set(FONT_FAMILIES.map(({ family }) => family));
    for (const family of SYMBOL_COVERAGE_FAMILIES) {
      const entry = COVERAGE_FONT_FAMILIES.find((candidate) => candidate.family === family);
      expect(entry, family).toBeDefined();
      expect(entry?.faces.map(({ weight, isItalic }) => [weight, isItalic])).toEqual([
        [400, false],
      ]);
      expect(visible.has(family), family).toBe(false);
    }
  });

  it('requests the symbol faces only for text holding symbols', () => {
    expect(coverageFamilies('Plain text')).toEqual([]);
    expect(coverageFamilies('Done ✓ More ⋯')).toEqual(['Noto Sans Math', 'Noto Sans Symbols 2']);
  });

  it('draws ⋯ and ✓ from the symbol faces in Liberation Sans text, leaving the runs as stored', () => {
    const fonts = new FontLibrary();
    for (const face of FONT_FACE_SOURCES) fonts.addFace(face, bytesOf(face));
    for (const entry of COVERAGE_FONT_FAMILIES.filter(({ family }) =>
      SYMBOL_COVERAGE_FAMILIES.includes(family),
    )) {
      for (const face of entry.faces) fonts.addFace(face, bytesOf(face));
    }
    const runs: readonly StyleRun[] = [{ length: 5, style: DEFAULT_TEXT_STYLE }];
    const snapshot = structuredClone(runs);
    const request = createLayoutJobRequest(
      { objectId: 'symbols', text: 'a⋯b✓c', runs, maxWidth: null, align: 'left' },
      fonts,
    );
    expect(runs).toEqual(snapshot);
    expect(request.runs.map((run) => [run.length, run.style.fontFamily])).toEqual([
      [1, 'Liberation Sans'],
      [1, 'Noto Sans Math'],
      [1, 'Liberation Sans'],
      [1, 'Noto Sans Math'],
      [1, 'Liberation Sans'],
    ]);
  });
});

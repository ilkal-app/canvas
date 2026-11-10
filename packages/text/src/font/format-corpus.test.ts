import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseFont } from './parse-font.js';

/** The font-format corpus, built by tooling/fonts/build-format-corpus.py. */
const CORPUS = new URL('../__fixtures__/format-corpus/', import.meta.url);

/** One fontTools RecordingPen operation: its name and points, font units. */
type PenOperation = readonly [string, readonly (readonly [number, number])[]];

/** What fontTools read from a corpus face: the reference our parser must match. */
interface Reference {
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly glyphs: Readonly<
    Record<string, { glyphId: number; advance: number; outline: readonly PenOperation[] }>
  >;
}

/**
 * Reads a corpus file.
 *
 * @param name - Its name.
 * @returns Its bytes.
 */
function corpusFile(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, CORPUS)));
}

describe.each(['corpus-sans-regular', 'corpus-sans-bold', 'corpus-serif-regular'])(
  'the TrueType face %s',
  (face) => {
    const reference = JSON.parse(
      readFileSync(new URL(`${face}.reference.json`, CORPUS), 'utf8'),
    ) as Reference;
    const font = parseFont(corpusFile(`${face}.ttf`));
    const em = reference.unitsPerEm;

    it('reads the metrics fontTools reads', () => {
      expect(font.unitsPerEm).toBe(em);
      expect(font.ascent * em).toBeCloseTo(reference.ascent, 9);
      // hhea stores the descent below the baseline as negative; ours is its positive distance.
      expect(font.descent * em).toBeCloseTo(-reference.descent, 9);
    });

    it.each(Object.entries(reference.glyphs))('maps %j to its glyph and advance', (char, glyph) => {
      expect(font.glyphIdOf(char.codePointAt(0) ?? 0)).toBe(glyph.glyphId);
      expect(font.advanceOf(glyph.glyphId) * em).toBeCloseTo(glyph.advance, 9);
    });

    it.each(Object.entries(reference.glyphs))(
      "draws %j through every on-curve point of fontTools' outline",
      (char, glyph) => {
        const ends = font
          .outlineOf(glyph.glyphId)
          .contours.flat()
          .map((segment) => [segment.x1 * em, segment.y1 * em] as const);
        const expected = glyph.outline.flatMap(([, points]) => points.slice(-1));
        expect(ends.length >= expected.length, char).toBe(true);
        for (const [x, y] of expected) {
          expect(
            ends.some(([ex, ey]) => Math.abs(ex - x) < 1e-6 && Math.abs(ey - y) < 1e-6),
            `${char}: (${String(x)}, ${String(y)})`,
          ).toBe(true);
        }
      },
    );
  },
);

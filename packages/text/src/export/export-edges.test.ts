// The edges of the vector export: empty contours, unreadable fonts, unshaped glyphs.
import { describe, expect, it } from 'vitest';

import type { TextLayout } from '../layout/text-layout.js';

import { fsTypeOf } from './fs-type.js';
import { composeAffine, glyphPathData, glyphPdfPath, IDENTITY_AFFINE } from './glyph-path-data.js';
import { textVectors } from './text-vectors.js';

const LINE = { kind: 'line', x0: 0, y0: 0, x1: 1, y1: 0 } as const;

describe('vector export edges', () => {
  it('skips an empty contour, and composes transforms inner first', () => {
    const outline = { contours: [[], [LINE]] };
    expect(glyphPathData(outline, IDENTITY_AFFINE)).toBe('M 0 0 L 1 0 Z');
    expect(glyphPdfPath(outline, IDENTITY_AFFINE)).toBe('0 0 m 1 0 l h');
    const scale = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    const move = { a: 1, b: 0, c: 0, d: 1, e: 5, f: 0 };
    expect(composeAffine(move, scale)).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 5, f: 0 });
  });

  it('refuses embedding for bytes that are not a font', () => {
    expect(fsTypeOf(Uint8Array.of(1, 2, 3)).canEmbed).toBe(false);
  });

  it('leaves out unshaped glyphs and glyphs with no run, and paints layers over a bitmap', () => {
    const glyph = { codepoint: 65, index: 0, end: 1, level: 0, line: 0, x: 0, y: 10, advance: 5 };
    const layout = {
      runs: [{ faceId: 'f', fontSize: 10, color: 'ink' }],
      glyphs: [
        { ...glyph, glyphId: null, run: 0 },
        { ...glyph, glyphId: 1, run: 7 },
        { ...glyph, glyphId: 2, run: 0 },
      ],
    } as unknown as TextLayout;
    const outline = { contours: [[LINE]] };
    expect(textVectors(layout, { outline: () => outline })).toEqual([
      expect.objectContaining({ kind: 'outline', glyphId: 2, fill: 'ink' }),
    ]);
    const vectors = textVectors(layout, {
      outline: () => outline,
      colourGlyph: () => ({
        ops: [
          { op: 'push-clip-glyph', outline },
          { op: 'solid', color: { r: 1, g: 0, b: 0, a: 1 }, isForeground: true },
          { op: 'pop-clip' },
          {
            op: 'image',
            ...{ format: 'png', bytes: Uint8Array.of(1), width: 1, height: 1 },
            ...{ xMin: 0, yMin: 0, xMax: 1, yMax: 1 },
          },
        ],
      }),
    });
    expect(vectors[0]).toMatchObject({ kind: 'layers', layers: [{ fill: 'ink' }] });
  });
});

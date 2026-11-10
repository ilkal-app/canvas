import { describe, expect, it } from 'vitest';

import * as text from '../index.js';
import type { GlyphOutline, LayoutGlyph } from '../index.js';

import { glyphPathData, glyphPdfPath, glyphTransform, type Affine } from './glyph-path-data.js';

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const MIXED: GlyphOutline = {
  contours: [
    [
      { kind: 'line', x0: 0, y0: 0, x1: 1, y1: 0 },
      { kind: 'quadratic', x0: 1, y0: 0, cx: 1, cy: 1, x1: 0, y1: 1 },
      { kind: 'cubic', x0: 0, y0: 1, c1x: -1, c1y: 1, c2x: -1, c2y: 0, x1: 0, y1: 0 },
    ],
  ],
};

/** A positioned glyph for checking em-to-box placement independently of the shaper. */
const GLYPH: LayoutGlyph = {
  codepoint: 65,
  index: 0,
  end: 1,
  glyphId: 1,
  level: 0,
  line: 0,
  x: 12,
  y: 30,
  advance: 8,
  run: 0,
};

describe('glyph outline path serialization', () => {
  it('exports the path and placement API from @canvas/text', () => {
    expect(text.glyphPathData).toBe(glyphPathData);
    expect(text.glyphPdfPath).toBe(glyphPdfPath);
    expect(text.glyphTransform).toBe(glyphTransform);
  });

  it('writes exact absolute SVG and PDF paths for lines, quadratics, cubics and closure', () => {
    expect(glyphPathData(MIXED, IDENTITY)).toBe('M 0 0 L 1 0 Q 1 1 0 1 C -1 1 -1 0 0 0 Z');
    expect(glyphPdfPath(MIXED, IDENTITY)).toBe(
      '0 0 m 1 0 l 1 0.667 0.667 1 0 1 c -1 1 -1 0 0 0 c h',
    );
  });

  it('raises a quadratic to a cubic at q0 + 2/3(q1-q0) and q2 + 2/3(q1-q2)', () => {
    const outline: GlyphOutline = {
      contours: [[{ kind: 'quadratic', x0: 0, y0: 0, cx: 3, cy: 6, x1: 9, y1: 0 }]],
    };
    expect(glyphPdfPath(outline, IDENTITY)).toBe('0 0 m 2 4 5 4 9 0 c h');
  });

  it('applies the full affine transform and flips em y-up into box y-down', () => {
    expect(glyphTransform(GLYPH, 20)).toEqual({ a: 20, b: 0, c: 0, d: -20, e: 12, f: 30 });
    const outline: GlyphOutline = {
      contours: [[{ kind: 'line', x0: 0, y0: 0, x1: 1, y1: 1 }]],
    };
    expect(glyphPathData(outline, glyphTransform(GLYPH, 20))).toBe('M 12 30 L 32 10 Z');
    const affine: Affine = { a: 0, b: 2, c: 3, d: 0, e: 5, f: 7 };
    expect(glyphPathData(outline, affine)).toBe('M 5 7 L 8 9 Z');
    expect(glyphPdfPath(outline, affine)).toBe('5 7 m 8 9 l h');
  });

  it('rounds to at most three decimals, removes negative zero and leaves empty outlines empty', () => {
    const outline: GlyphOutline = {
      contours: [
        [
          {
            kind: 'line',
            x0: -0.0001,
            y0: -0,
            x1: 1 / 3,
            y1: -1 / 3,
          },
        ],
      ],
    };
    expect(glyphPathData(outline, IDENTITY)).toBe('M 0 0 L 0.333 -0.333 Z');
    expect(glyphPdfPath(outline, IDENTITY)).toBe('0 0 m 0.333 -0.333 l h');
    expect(glyphPathData({ contours: [] }, IDENTITY)).toBe('');
    expect(glyphPdfPath({ contours: [] }, IDENTITY)).toBe('');
  });
});

import { describe, expect, it } from 'vitest';

import type { GlyphOutline } from '@canvas/text';
import { parseFont } from '@canvas/text';

import { loadRegularFontBytes } from '../__fixtures__/bundled-fonts.js';
import { DISTANCE_RANGE_PX, GLYPH_PADDING_PX } from '../atlas/glyph-bitmap.js';

import { rasterizeSdfGlyph } from './sdf-rasterizer.js';

/** A 0.5 em square from (0.25, 0) to (0.75, 0.5), wound as TrueType winds outer contours. */
const SQUARE: GlyphOutline = {
  contours: [
    [
      { kind: 'line', x0: 0.25, y0: 0, x1: 0.25, y1: 0.5 },
      { kind: 'line', x0: 0.25, y0: 0.5, x1: 0.75, y1: 0.5 },
      { kind: 'line', x0: 0.75, y0: 0.5, x1: 0.75, y1: 0 },
      { kind: 'line', x0: 0.75, y0: 0, x1: 0.25, y1: 0 },
    ],
  ],
};

const encode = (distancePx: number): number =>
  Math.round(Math.min(1, Math.max(0, 0.5 + distancePx / DISTANCE_RANGE_PX)) * 255);

describe('rasterizeSdfGlyph', () => {
  const tier = 64;
  const glyph = rasterizeSdfGlyph(SQUARE, 0.6, tier);
  const at = (x: number, y: number): number => glyph.pixels[y * glyph.width + x] ?? -1;

  it('pads the outline bounds by the field padding and places the bitmap from them', () => {
    // The square spans 16..48 px in x and 0..32 px in y at 64 px per em.
    expect(glyph).toMatchObject({
      field: 'sdf',
      width: 32 + 2 * GLYPH_PADDING_PX,
      height: 32 + 2 * GLYPH_PADDING_PX,
      left: 16 - GLYPH_PADDING_PX,
      top: 32 + GLYPH_PADDING_PX,
      advance: 0.6 * tier,
    });
    expect(glyph.pixels).toHaveLength(glyph.width * glyph.height);
  });

  it('encodes the true distance at texel centres: 0.5 on the edge, above inside, below outside', () => {
    // Texel (8, 20) is centred 0.5 px inside the left edge; (7, 20) 0.5 px outside it.
    expect(at(8, 20)).toBe(encode(0.5));
    expect(at(7, 20)).toBe(encode(-0.5));
    expect(at(24, 24)).toBe(encode(8)); // the centre saturates at the range
    expect(at(0, 0)).toBe(0);
    // A corner: the nearest point outside the top-left corner is the corner itself.
    expect(at(5, 5)).toBe(encode(-Math.hypot(2.5, 2.5)));
  });

  it('fills holes by the non-zero winding rule', () => {
    const ring: GlyphOutline = {
      contours: [
        ...SQUARE.contours,
        [
          { kind: 'line', x0: 0.375, y0: 0.125, x1: 0.625, y1: 0.125 },
          { kind: 'line', x0: 0.625, y0: 0.125, x1: 0.625, y1: 0.375 },
          { kind: 'line', x0: 0.625, y0: 0.375, x1: 0.375, y1: 0.375 },
          { kind: 'line', x0: 0.375, y0: 0.375, x1: 0.375, y1: 0.125 },
        ],
      ],
    };
    const holed = rasterizeSdfGlyph(ring, 0.6, tier);
    expect(holed.pixels[24 * holed.width + 24]).toBeLessThan(128);
    expect(holed.pixels[10 * holed.width + 10]).toBeGreaterThan(128);
  });

  it('gives a glyph without contours an empty bitmap and keeps its advance', () => {
    expect(rasterizeSdfGlyph({ contours: [] }, 0.25, tier)).toMatchObject({
      width: 0,
      height: 0,
      advance: 16,
    });
  });

  it('rasterises a real glyph with curves: the bowl of "o" is inside, its counter outside', () => {
    const font = parseFont(loadRegularFontBytes());
    const glyphId = font.glyphIdOf(0x6f);
    const o = rasterizeSdfGlyph(font.outlineOf(glyphId), font.advanceOf(glyphId), tier);
    const centre = Math.floor(o.height / 2) * o.width + Math.floor(o.width / 2);
    expect(o.pixels[centre]).toBeLessThan(128);
    const row = [
      ...o.pixels.subarray(
        Math.floor(o.height / 2) * o.width,
        (Math.floor(o.height / 2) + 1) * o.width,
      ),
    ];
    const insideRuns =
      row
        .map((value) => (value > 127 ? 1 : 0))
        .join('')
        .match(/1+/g) ?? [];
    expect(insideRuns).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import { layoutText, type TextLayout } from '@canvas/text';

import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import type { GlyphBitmap } from '../atlas/glyph-bitmap.js';
import { BASE_TIER, HIGH_TIER, type GlyphTier } from '../atlas/glyph-tiers.js';
import { FakeGlyphMeasurer } from '../layout/__fixtures__/fake-glyph-measurer.js';

import { orderedGlyphQuads } from './ordered-glyph-quads.js';

const FACE = '400|n|Fake';
const PLACEMENT = { originX: 0, originY: 0, scale: 1 };
const LIGATURE_ID = 924;

/**
 * "AB" laid out per codepoint, then its first glyph given a glyph id, as shaping gives a ligature.
 *
 * @returns The layout.
 * @throws {Error} When the layout has no glyph.
 */
function shapedLayout(): TextLayout {
  const style: TextStyle = {
    fontFamily: 'Fake',
    fontSize: 64,
    color: [0, 0, 0, 1],
    weight: 400,
    italic: false,
  };
  const layout = layoutText('AB', [{ length: 2, style }], null, new FakeGlyphMeasurer());
  const [first, ...rest] = layout.glyphs;
  if (first === undefined) throw new Error('Expected a glyph.');
  return { ...layout, glyphs: [{ ...first, glyphId: LIGATURE_ID, end: 2 }, ...rest] };
}

function bitmap(width: number): GlyphBitmap {
  return {
    field: 'msdf',
    width,
    height: 4,
    pixels: new Uint8Array(width * 4 * 4),
    left: 0,
    top: 4,
    advance: width,
  };
}

describe('orderedGlyphQuads', () => {
  it('looks a shaped glyph up and requests it by its glyph id, not its codepoint', () => {
    const atlas = new GlyphAtlas({ pageSize: 256 });
    // An entry under the shaped glyph's codepoint must not stand in for the ligature.
    atlas.insert(FACE, 0x41, BASE_TIER, bitmap(3));
    const requests: [string, number, GlyphTier][] = [];
    const missing = orderedGlyphQuads(shapedLayout(), PLACEMENT, atlas, {
      request: (face, glyph, tier) => requests.push([face.faceId, glyph, tier]),
    });
    expect(requests).toEqual([
      [FACE, -1 - LIGATURE_ID, BASE_TIER],
      [FACE, 0x42, BASE_TIER],
    ]);
    expect(missing.quads[0]).toBeUndefined();

    atlas.insert(FACE, -1 - LIGATURE_ID, BASE_TIER, bitmap(7));
    const drawn = orderedGlyphQuads(shapedLayout(), PLACEMENT, atlas);
    expect(drawn.quads[0]?.quad.width).toBe(7);
  });
});

describe('orderedGlyphQuads on small pages', () => {
  it('asks no higher than the atlas’s highest tier', () => {
    const atlas = new GlyphAtlas({ pageSize: 512 });
    const requests: GlyphTier[] = [];
    // 64 px text at 10× is 640 device px per em: the top tier, which a 512 page cannot hold.
    const built = orderedGlyphQuads(shapedLayout(), { ...PLACEMENT, scale: 10 }, atlas, {
      request: (face, glyph, tier) => requests.push(tier),
    });
    expect(built.tiers).toEqual([HIGH_TIER]);
    expect(built.maxTier).toBe(HIGH_TIER);
    expect(new Set(requests)).toEqual(new Set([HIGH_TIER, BASE_TIER]));
  });
});

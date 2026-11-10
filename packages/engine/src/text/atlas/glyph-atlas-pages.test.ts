import { describe, expect, it } from 'vitest';

import { GlyphAtlas } from './glyph-atlas.js';
import type { GlyphBitmap } from './glyph-bitmap.js';
import { BASE_TIER } from './glyph-tiers.js';

/**
 * A single-channel bitmap filling most of a 32-texel page.
 *
 * @returns The bitmap.
 */
function fullPage(): GlyphBitmap {
  return {
    field: 'sdf',
    width: 28,
    height: 28,
    pixels: new Uint8Array(28 * 28),
    left: 0,
    top: 28,
    advance: 28,
  };
}

/** An R8 page of 32 texels, in bytes. */
const SMALL = 32 * 32;

describe('GlyphAtlas urgent release', () => {
  it('releases pages used in this frame only when urgent', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, budgetBytes: 2 * SMALL });
    atlas.insert('face', 1, BASE_TIER, fullPage());
    atlas.insert('face', 2, BASE_TIER, fullPage());
    atlas.beginFrame();
    atlas.lookup('face', 1, BASE_TIER);
    atlas.lookup('face', 2, BASE_TIER);
    atlas.setBudget(SMALL);
    expect(atlas.pages).toHaveLength(2);
    atlas.setBudget(SMALL, true);
    expect(atlas.pages).toHaveLength(1);
  });
});

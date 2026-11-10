import { describe, expect, it } from 'vitest';

import { budgetForDevice } from '../../memory/device-budget.js';

import { FRAME_TITLE_ATLAS_SHARE, createTextAtlas } from './glyph-atlas-sizing.js';
import { GlyphAtlas } from './glyph-atlas.js';
import type { GlyphBitmap } from './glyph-bitmap.js';
import { cappedTier, glyphCellSide, maxTierForPage } from './glyph-cell.js';
import { BASE_TIER, HIGH_TIER, MAX_TIER } from './glyph-tiers.js';

const FACE = '400|n|Fake';

/**
 * An MSDF bitmap of a square glyph.
 *
 * @param side - Its side, texels.
 * @returns The bitmap.
 */
function squareBitmap(side: number): GlyphBitmap {
  return {
    field: 'msdf',
    width: side,
    height: side,
    pixels: new Uint8Array(side * side * 4),
    left: 0,
    top: side,
    advance: side,
  };
}

describe('glyph cells and the page tier cap', () => {
  it('sizes a cell as 1.25 em plus padding and gutter on both sides', () => {
    expect(glyphCellSide(BASE_TIER)).toBe(98);
    expect(glyphCellSide(HIGH_TIER)).toBe(338);
    expect(glyphCellSide(MAX_TIER)).toBe(658);
  });

  it('caps a page at the highest tier whose cells fit it', () => {
    expect(maxTierForPage(2048)).toBe(MAX_TIER);
    expect(maxTierForPage(1024)).toBe(MAX_TIER);
    expect(maxTierForPage(512)).toBe(HIGH_TIER);
    expect(maxTierForPage(256)).toBe(BASE_TIER);
    expect(maxTierForPage(16)).toBe(BASE_TIER);
  });

  it('caps a wanted tier, and leaves it alone without a cap', () => {
    expect(cappedTier(MAX_TIER, HIGH_TIER)).toBe(HIGH_TIER);
    expect(cappedTier(BASE_TIER, HIGH_TIER)).toBe(BASE_TIER);
    expect(cappedTier(MAX_TIER, undefined)).toBe(MAX_TIER);
  });

  it('gives an atlas its pages’ cap, which places an em-sized glyph at that tier', () => {
    const atlas = new GlyphAtlas({ pageSize: 512 });
    expect(atlas.maxTier).toBe(HIGH_TIER);
    // An em of the top tier with its padding (530 texels) can never fit a 512 page...
    expect(atlas.insert(FACE, 0x41, MAX_TIER, squareBitmap(MAX_TIER + 16))).toBeUndefined();
    // ...while one of the capped tier does.
    expect(atlas.insert(FACE, 0x41, HIGH_TIER, squareBitmap(HIGH_TIER + 16))).toBeDefined();
  });

  it('keeps a page for the frame titles on the smallest device budget', () => {
    const budget = budgetForDevice({ isMobile: true, maxTextureSize: 4096, deviceMemoryGb: 0.25 });
    const atlas = createTextAtlas(budget, undefined, FRAME_TITLE_ATLAS_SHARE);
    expect(atlas.pageSize).toBe(512);
    expect(atlas.memory().budgetBytes).toBe(512 * 512 * 4);
    expect(atlas.insert(FACE, 0x41, BASE_TIER, squareBitmap(BASE_TIER + 16))).toBeDefined();
  });
});

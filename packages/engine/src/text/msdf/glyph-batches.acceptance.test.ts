import { describe, expect, it } from 'vitest';

import { GLYPH_ATLAS_GUTTER } from '../atlas/glyph-atlas.js';
import { GLYPH_PADDING_PX } from '../atlas/glyph-bitmap.js';
import { BASE_TIER, MAX_TIER } from '../atlas/glyph-tiers.js';

import { planGlyphBatches } from './glyph-batches.js';

/**
 * The number of conservative square glyph cells that fit on one atlas page.
 *
 * @param pageSize - Atlas page side, in texels.
 * @param tier - Glyph raster tier, in texels per em.
 * @returns The capacity of one page.
 */
function glyphsPerPage(pageSize: number, tier: number): number {
  const cell = Math.ceil(tier * 1.25) + 2 * GLYPH_PADDING_PX + 2 * GLYPH_ATLAS_GUTTER;
  return Math.floor(pageSize / cell) ** 2;
}

describe('page-sized MSDF batches', () => {
  it.each([512, 1024, 2048])('keeps every tier-64 batch within a %i page', (pageSize) => {
    const capacity = glyphsPerPage(pageSize, BASE_TIER);
    const keys = Array.from({ length: capacity * 2 + 1 }, (ignored, index) => index + 1);
    const batches = planGlyphBatches(keys, BASE_TIER, pageSize);
    expect(batches.map((batch) => batch.length)).toEqual([capacity, capacity, 1]);
    expect(batches.flat()).toEqual(keys);
  });

  it('keeps at least one glyph per batch at the top tier on a 512 page', () => {
    const keys = [1, 2, 3];
    expect(planGlyphBatches(keys, MAX_TIER, 512)).toEqual([[1], [2], [3]]);
  });

  it('defaults to 2048-page batching', () => {
    const keys = Array.from(
      { length: glyphsPerPage(2048, BASE_TIER) + 1 },
      (ignored, index) => index,
    );
    expect(planGlyphBatches(keys, BASE_TIER)).toEqual(planGlyphBatches(keys, BASE_TIER, 2048));
  });
});

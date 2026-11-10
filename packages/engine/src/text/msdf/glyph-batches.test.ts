import { describe, expect, it } from 'vitest';

import { BASE_TIER, MAX_TIER } from '../atlas/glyph-tiers.js';

import { MAX_BATCH_SIDE_PX, planGlyphBatches } from './glyph-batches.js';

// Ported from the prototype's `planBatches` test (`src/atlas/msdfSource.test.ts`).
describe('planGlyphBatches', () => {
  it('keeps a small request in one batch', () => {
    expect(planGlyphBatches([1, 2, 3], BASE_TIER)).toEqual([[1, 2, 3]]);
  });

  it('splits a large request so each batch fits a 2048-texel square of glyph cells', () => {
    const codepoints = [...Array(1600).keys()].map((index) => 0x4e00 + index);
    const batches = planGlyphBatches(codepoints, BASE_TIER);
    expect(batches.length).toBe(4);
    expect(batches.flat()).toEqual(codepoints);
    const cell = Math.ceil(BASE_TIER * 1.25) + 16;
    const perSide = Math.floor(MAX_BATCH_SIDE_PX / cell);
    expect(batches.every((batch) => batch.length <= perSide * perSide)).toBe(true);
  });

  it('batches few glyphs at the highest tier and never fewer than one', () => {
    expect(
      planGlyphBatches([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], MAX_TIER).map((b) => b.length),
    ).toEqual([9, 1]);
    expect(planGlyphBatches([], MAX_TIER)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { GLYPH_ATLAS_GUTTER, GlyphAtlas } from './glyph-atlas.js';
import { BASE_TIER } from './glyph-tiers.js';

function bitmap(field: 'sdf' | 'msdf') {
  return {
    field,
    width: 4,
    height: 3,
    pixels: new Uint8Array(4 * 3 * (field === 'sdf' ? 1 : 3)),
    left: 0,
    top: 3,
    advance: 4,
  };
}

describe('GlyphAtlas single-channel page size', () => {
  it('uses each field’s page side for allocation, UVs, and resident bytes', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, singleChannelPageSize: 64, budgetBytes: 8192 });
    const sdf = atlas.insert('face', 1, BASE_TIER, bitmap('sdf'));
    const msdf = atlas.insert('face', 2, BASE_TIER, bitmap('msdf'));
    expect(atlas.pages).toEqual([
      { id: 0, field: 'sdf', format: 'r8unorm', size: 64 },
      { id: 1, field: 'msdf', format: 'rgba8unorm', size: 32 },
    ]);
    const gutter = GLYPH_ATLAS_GUTTER;
    expect(sdf).toMatchObject({
      u0: gutter / 64,
      v0: gutter / 64,
      u1: (gutter + 4) / 64,
      v1: (gutter + 3) / 64,
    });
    expect(msdf).toMatchObject({
      u0: gutter / 32,
      v0: gutter / 32,
      u1: (gutter + 4) / 32,
      v1: (gutter + 3) / 32,
    });
    expect(atlas.memory().residentBytes).toBe(64 * 64 + 32 * 32 * 4);
  });

  it('refuses a larger R8 page when its own byte cost exceeds the budget', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, singleChannelPageSize: 128, budgetBytes: 4096 });
    expect(atlas.insert('face', 1, BASE_TIER, bitmap('sdf'))).toBeUndefined();
    expect(atlas.pages).toEqual([]);
    expect(atlas.insert('face', 2, BASE_TIER, bitmap('msdf'))).toBeDefined();
    expect(atlas.memory().residentBytes).toBe(4096);
  });

  it('raises a single-channel side below pageSize to pageSize', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, singleChannelPageSize: 16 });
    expect(atlas.singleChannelPageSize).toBe(32);
    atlas.insert('face', 1, BASE_TIER, bitmap('sdf'));
    expect(atlas.pages[0]?.size).toBe(32);
  });
});

import { describe, expect, it } from 'vitest';

import { REGENERATION_WINDOW_MS } from '../../memory/eviction-memory.js';

import { GLYPH_ATLAS_GUTTER, GlyphAtlas } from './glyph-atlas.js';
import type { GlyphBitmap, GlyphField } from './glyph-bitmap.js';
import { BASE_TIER, HIGH_TIER } from './glyph-tiers.js';

const FACE = '400|n|Fake';
const PAGE = 64;

/**
 * Makes a glyph bitmap whose texels all hold one value.
 *
 * @param width - Width, in texels.
 * @param height - Height, in texels.
 * @param value - Every texel's value.
 * @param field - The encoding: three channels for msdf, one for sdf.
 * @returns The bitmap.
 */
function bitmap(
  width: number,
  height: number,
  value = 200,
  field: GlyphField = 'msdf',
): GlyphBitmap {
  const channels = field === 'msdf' ? 3 : 1;
  return {
    field,
    width,
    height,
    pixels: new Uint8Array(width * height * channels).fill(value),
    left: -1,
    top: 2,
    advance: 30,
  };
}

describe('GlyphAtlas', () => {
  it('packs an MSDF glyph into an RGBA page and records its placement and metrics', () => {
    const atlas = new GlyphAtlas({ pageSize: PAGE });
    const glyph = atlas.insert(FACE, 65, BASE_TIER, bitmap(4, 3));
    const g = GLYPH_ATLAS_GUTTER;
    expect(glyph).toEqual({
      pageId: 0,
      field: 'msdf',
      u0: g / PAGE,
      v0: g / PAGE,
      u1: (g + 4) / PAGE,
      v1: (g + 3) / PAGE,
      width: 4,
      height: 3,
      left: -1,
      top: 2,
      advance: 30,
      tier: BASE_TIER,
    });
    expect(atlas.pages).toEqual([{ id: 0, field: 'msdf', format: 'rgba8unorm', size: PAGE }]);
    expect(atlas.lookup(FACE, 65, BASE_TIER)).toEqual(glyph);
  });

  it('queues the glyph cell as a sub-region upload, RGB expanded to RGBA, gutter cleared', () => {
    const atlas = new GlyphAtlas({ pageSize: PAGE });
    atlas.insert(FACE, 65, BASE_TIER, bitmap(4, 3, 9));
    const [upload] = atlas.takeUploads();
    const g = GLYPH_ATLAS_GUTTER;
    expect(upload?.pageId).toBe(0);
    expect(upload?.region).toEqual({ x: 0, y: 0, width: 4 + 2 * g, height: 3 + 2 * g });
    const rowBytes = (4 + 2 * g) * 4;
    const inside = g * rowBytes + g * 4;
    expect([...(upload?.texels.subarray(inside, inside + 4) ?? [])]).toEqual([9, 9, 9, 255]);
    expect([...(upload?.texels.subarray(0, 4) ?? [])]).toEqual([0, 0, 0, 0]);
    expect(atlas.takeUploads()).toEqual([]);
  });

  it('puts single-channel fallback glyphs in R8 pages', () => {
    const atlas = new GlyphAtlas({ pageSize: PAGE });
    atlas.insert(FACE, 65, BASE_TIER, bitmap(4, 3, 7, 'sdf'));
    expect(atlas.pages).toEqual([{ id: 0, field: 'sdf', format: 'r8unorm', size: PAGE }]);
    const [upload] = atlas.takeUploads();
    expect(upload?.texels.length).toBe((4 + 2 * GLYPH_ATLAS_GUTTER) * (3 + 2 * GLYPH_ATLAS_GUTTER));
  });

  it('keys entries by face, codepoint and tier', () => {
    const atlas = new GlyphAtlas({ pageSize: PAGE });
    atlas.insert(FACE, 65, BASE_TIER, bitmap(4, 3));
    expect(atlas.lookup(FACE, 65, HIGH_TIER)).toBeUndefined();
    expect(atlas.lookup('700|n|Fake', 65, BASE_TIER)).toBeUndefined();
    expect(atlas.lookup(FACE, 66, BASE_TIER)).toBeUndefined();
  });

  it('stores a blank glyph without texels', () => {
    const atlas = new GlyphAtlas({ pageSize: PAGE });
    const space = atlas.insert(FACE, 32, BASE_TIER, bitmap(0, 0));
    expect(space).toMatchObject({ pageId: undefined, width: 0, advance: 30 });
    expect(atlas.pages).toEqual([]);
    expect(atlas.takeUploads()).toEqual([]);
    expect(atlas.lookup(FACE, 32, BASE_TIER)).toBe(space);
  });

  it('replaces an entry, freeing the old cell (a fallback glyph superseded by MSDF)', () => {
    const atlas = new GlyphAtlas({ pageSize: PAGE });
    atlas.insert(FACE, 65, BASE_TIER, bitmap(4, 3, 1, 'sdf'));
    const msdf = atlas.insert(FACE, 65, BASE_TIER, bitmap(4, 3));
    expect(atlas.lookup(FACE, 65, BASE_TIER)).toBe(msdf);
    expect(atlas.pages.map(({ format }) => format)).toEqual(['rgba8unorm']);
  });

  it('bumps its revision on every insert and eviction, so cached quads know to rebuild', () => {
    const atlas = new GlyphAtlas({ pageSize: PAGE });
    const start = atlas.revision;
    atlas.insert(FACE, 65, BASE_TIER, bitmap(4, 3));
    expect(atlas.revision).toBe(start + 1);
    atlas.lookup(FACE, 65, BASE_TIER);
    expect(atlas.revision).toBe(start + 1);
  });

  it('rejects a glyph larger than a page', () => {
    const atlas = new GlyphAtlas({ pageSize: PAGE });
    expect(atlas.insert(FACE, 65, BASE_TIER, bitmap(PAGE, 4))).toBeUndefined();
    expect(atlas.memory().rejectedGlyphCount).toBe(1);
  });
});

describe('GlyphAtlas eviction under a byte budget', () => {
  // One RGBA page of 16×16 texels (1 KiB) holds four 6×6 cells (4×4 bitmaps plus gutter).
  const smallPage = 16;
  const onePage = (): GlyphAtlas =>
    new GlyphAtlas({ pageSize: smallPage, budgetBytes: smallPage * smallPage * 4 });
  const fill = (atlas: GlyphAtlas, codepoints: readonly number[]): void => {
    for (const codepoint of codepoints) atlas.insert(FACE, codepoint, BASE_TIER, bitmap(4, 4));
  };

  it('reports the atlas memory category: resident page bytes against the budget', () => {
    const atlas = onePage();
    fill(atlas, [1, 2]);
    expect(atlas.memory()).toEqual({
      category: 'glyph-atlas',
      residentBytes: smallPage * smallPage * 4,
      budgetBytes: smallPage * smallPage * 4,
      pageCount: 1,
      glyphCount: 2,
      evictedGlyphCount: 0,
      regeneratedGlyphCount: 0,
      rejectedGlyphCount: 0,
    });
  });

  it('counts a glyph inserted again within a sweep of its eviction as regenerated', () => {
    const atlas = onePage();
    atlas.beginFrame(1_000);
    fill(atlas, [1, 2, 3, 4]);
    atlas.beginFrame(2_000);
    fill(atlas, [5]);
    expect(atlas.memory().evictedGlyphCount).toBe(1);
    atlas.beginFrame(3_000);
    fill(atlas, [1]);
    expect(atlas.regeneratedGlyphCount).toBe(1);
    // Evicted again at 3 s (glyph 2 made room), but inserted only after the 8 s window.
    atlas.beginFrame(3_000 + REGENERATION_WINDOW_MS + 1);
    fill(atlas, [2]);
    expect(atlas.regeneratedGlyphCount).toBe(1);
  });

  it('evicts the least recently used glyph when the budget allows no new page', () => {
    const atlas = onePage();
    fill(atlas, [1, 2, 3, 4]);
    atlas.beginFrame();
    atlas.lookup(FACE, 1, BASE_TIER);
    fill(atlas, [5]);
    expect(atlas.lookup(FACE, 2, BASE_TIER)).toBeUndefined();
    expect(atlas.lookup(FACE, 1, BASE_TIER)).toBeDefined();
    expect(atlas.lookup(FACE, 5, BASE_TIER)?.pageId).toBe(0);
    expect(atlas.memory()).toMatchObject({ pageCount: 1, glyphCount: 4, evictedGlyphCount: 1 });
  });

  it('never evicts a glyph used in the current frame, and rejects instead', () => {
    const atlas = onePage();
    fill(atlas, [1, 2, 3, 4]);
    expect(atlas.insert(FACE, 5, BASE_TIER, bitmap(4, 4))).toBeUndefined();
    expect(atlas.memory()).toMatchObject({ glyphCount: 4, rejectedGlyphCount: 1 });
  });

  it('releases a page once eviction empties it, making room for a page of another format', () => {
    const atlas = onePage();
    fill(atlas, [1]);
    atlas.beginFrame();
    const fallback = atlas.insert(FACE, 9, BASE_TIER, bitmap(4, 4, 5, 'sdf'));
    expect(fallback?.pageId).toBe(1);
    expect(atlas.pages).toEqual([{ id: 1, field: 'sdf', format: 'r8unorm', size: smallPage }]);
    expect(atlas.lookup(FACE, 1, BASE_TIER)).toBeUndefined();
  });

  it('drops queued uploads of a released page', () => {
    const atlas = onePage();
    fill(atlas, [1]);
    atlas.beginFrame();
    atlas.insert(FACE, 9, BASE_TIER, bitmap(4, 4, 5, 'sdf'));
    expect(atlas.takeUploads().map(({ pageId }) => pageId)).toEqual([1]);
  });

  it('keeps blank glyphs, which cost nothing, out of eviction', () => {
    const atlas = onePage();
    atlas.insert(FACE, 32, BASE_TIER, bitmap(0, 0));
    fill(atlas, [1, 2, 3, 4]);
    atlas.beginFrame();
    fill(atlas, [5, 6, 7, 8, 9]);
    expect(atlas.lookup(FACE, 32, BASE_TIER)).toBeDefined();
  });

  it('clears every entry and page, for a lost device', () => {
    const atlas = onePage();
    fill(atlas, [1, 2]);
    atlas.clear();
    expect(atlas.pages).toEqual([]);
    expect(atlas.lookup(FACE, 1, BASE_TIER)).toBeUndefined();
    expect(atlas.takeUploads()).toEqual([]);
    expect(atlas.memory()).toMatchObject({ residentBytes: 0, glyphCount: 0 });
  });
});

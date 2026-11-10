import { describe, expect, it, vi } from 'vitest';

import { GlyphAtlas } from './glyph-atlas.js';
import { BASE_TIER } from './glyph-tiers.js';

const PAGE_BYTES = 32 * 32;
const FULL_PAGE = {
  field: 'sdf' as const,
  width: 30,
  height: 30,
  pixels: new Uint8Array(30 * 30),
  left: 0,
  top: 30,
  advance: 30,
};
const QUARTER_PAGE = {
  ...FULL_PAGE,
  width: 14,
  height: 14,
  pixels: new Uint8Array(14 * 14),
};

/**
 * Calls the new runtime budget API while the implementation has yet to land.
 *
 * @param atlas - The atlas.
 * @param bytes - Its new cap.
 */
function setBudget(atlas: GlyphAtlas, bytes: number): void {
  (atlas as GlyphAtlas & { setBudget(bytes: number): void }).setBudget(bytes);
}

describe('GlyphAtlas.setBudget', () => {
  it("uses each page's newest glyph when deciding which whole page is least recent", () => {
    const atlas = new GlyphAtlas({ pageSize: 32, budgetBytes: 2 * PAGE_BYTES });
    const onEvict = vi.fn();
    atlas.onEvict = onEvict;
    const glyphs: ReturnType<GlyphAtlas['insert']>[] = [];
    for (let key = 0; key < 8; key += 1) {
      glyphs.push(atlas.insert('face', key, BASE_TIER, QUARTER_PAGE));
    }
    const firstPage = glyphs[0]?.pageId;
    const secondPage = glyphs[4]?.pageId;
    expect(firstPage).not.toBe(secondPage);
    atlas.beginFrame();
    atlas.lookup('face', 0, BASE_TIER);
    atlas.beginFrame();

    setBudget(atlas, PAGE_BYTES);

    expect(atlas.pages.map(({ id }) => id)).toEqual([firstPage]);
    expect(atlas.memory()).toMatchObject({ glyphCount: 4, evictedGlyphCount: 4 });
    expect(onEvict.mock.calls).toEqual(glyphs.slice(4).map((glyph) => [glyph]));
    for (let key = 0; key < 4; key += 1) {
      expect(atlas.lookup('face', key, BASE_TIER)).toBe(glyphs[key]);
    }
    for (let key = 4; key < 8; key += 1) {
      expect(atlas.lookup('face', key, BASE_TIER)).toBeUndefined();
    }
  });

  it('releases whole pages by their most recent glyph, calling onEvict for every glyph', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, budgetBytes: 3 * PAGE_BYTES });
    const onEvict = vi.fn();
    atlas.onEvict = onEvict;
    const oldest = atlas.insert('face', 1, BASE_TIER, FULL_PAGE);
    const middle = atlas.insert('face', 2, BASE_TIER, FULL_PAGE);
    const newest = atlas.insert('face', 3, BASE_TIER, FULL_PAGE);
    atlas.beginFrame();
    atlas.lookup('face', 1, BASE_TIER);
    atlas.beginFrame();

    setBudget(atlas, PAGE_BYTES);

    expect(atlas.pages.map(({ id }) => id)).toEqual([oldest?.pageId]);
    expect(atlas.lookup('face', 1, BASE_TIER)).toBe(oldest);
    expect(atlas.lookup('face', 2, BASE_TIER)).toBeUndefined();
    expect(atlas.lookup('face', 3, BASE_TIER)).toBeUndefined();
    expect(onEvict.mock.calls).toEqual([[middle], [newest]]);
    expect(atlas.memory()).toMatchObject({
      budgetBytes: PAGE_BYTES,
      residentBytes: PAGE_BYTES,
      pageCount: 1,
      glyphCount: 1,
      evictedGlyphCount: 2,
    });
  });

  it('protects pages with a glyph used in the current frame, then releases them next frame', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, budgetBytes: 2 * PAGE_BYTES });
    const onEvict = vi.fn();
    atlas.onEvict = onEvict;
    const protectedGlyph = atlas.insert('face', 1, BASE_TIER, FULL_PAGE);
    const idleGlyph = atlas.insert('face', 2, BASE_TIER, FULL_PAGE);
    atlas.beginFrame();
    atlas.lookup('face', 1, BASE_TIER);

    setBudget(atlas, 0);

    expect(atlas.pages.map(({ id }) => id)).toEqual([protectedGlyph?.pageId]);
    expect(atlas.memory()).toMatchObject({ budgetBytes: 0, residentBytes: PAGE_BYTES });
    expect(onEvict.mock.calls).toEqual([[idleGlyph]]);
    atlas.beginFrame();
    setBudget(atlas, 0);
    expect(atlas.memory()).toMatchObject({ residentBytes: 0, evictedGlyphCount: 2 });
    expect(onEvict.mock.calls).toEqual([[idleGlyph], [protectedGlyph]]);
  });

  it('opens fresh pages for later inserts after its budget rises', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, budgetBytes: PAGE_BYTES });
    atlas.insert('face', 1, BASE_TIER, FULL_PAGE);
    expect(atlas.insert('face', 2, BASE_TIER, FULL_PAGE)).toBeUndefined();

    setBudget(atlas, 2 * PAGE_BYTES);
    const added = atlas.insert('face', 2, BASE_TIER, FULL_PAGE);

    expect(added?.pageId).toBe(1);
    expect(atlas.memory()).toMatchObject({
      budgetBytes: 2 * PAGE_BYTES,
      residentBytes: 2 * PAGE_BYTES,
      pageCount: 2,
      glyphCount: 2,
    });
  });
});

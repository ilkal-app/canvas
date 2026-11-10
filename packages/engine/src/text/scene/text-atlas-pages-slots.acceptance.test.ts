import { describe, expect, it } from 'vitest';

import { FakeGpuBackend } from '../../scene/__fixtures__/fake-gpu-backend.js';
import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';

import { TextAtlasPages } from './text-atlas-pages.js';

const BITMAP = {
  field: 'sdf' as const,
  width: 30,
  height: 30,
  pixels: new Uint8Array(30 * 30),
  left: 0,
  top: 30,
  advance: 30,
};

describe('TextAtlasPages.slotsOf', () => {
  it('counts reserved pages before sync, keeps holes, and tracks the second group separately', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, budgetBytes: 10 * 32 * 32 });
    const pages = new TextAtlasPages(new FakeGpuBackend(), atlas, 4);
    expect(pages.slotsOf(0)).toBe(1);
    expect(pages.slotsOf(1)).toBe(1);
    const ids = Array.from({ length: 6 }, (value, index) => {
      const glyph = atlas.insert('face', index, BASE_TIER, BITMAP);
      if (glyph?.pageId === undefined) throw new Error('Fixture page rejected');
      return glyph.pageId;
    });
    ids.forEach((id, index) => {
      expect(pages.placementOf(id)).toEqual({ group: Math.floor(index / 4), index: index % 4 });
    });
    expect(pages.slotsOf(0)).toBe(4);
    expect(pages.slotsOf(1)).toBe(2);
    pages.sync();
    atlas.beginFrame();
    atlas.insert('face', 3, BASE_TIER, { ...BITMAP, width: 0, height: 0 });
    atlas.insert('face', 5, BASE_TIER, { ...BITMAP, width: 0, height: 0 });
    pages.sync();
    expect(pages.slotsOf(0)).toBe(3);
    expect(pages.slotsOf(1)).toBe(1);
    expect(pages.placementOf(ids[2] ?? -1)).toEqual({ group: 0, index: 2 });
    pages.destroy();
  });
});

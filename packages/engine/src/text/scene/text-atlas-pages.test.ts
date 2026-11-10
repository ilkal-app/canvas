import { describe, expect, it } from 'vitest';

import { FakeGpuBackend } from '../../scene/__fixtures__/fake-gpu-backend.js';
import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import type { GlyphBitmap } from '../atlas/glyph-bitmap.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';

import { TextAtlasPages } from './text-atlas-pages.js';

/** A glyph that fills a 32-texel page, so each one opens a page. */
const PAGE_GLYPH: GlyphBitmap = {
  field: 'sdf',
  width: 28,
  height: 28,
  pixels: new Uint8Array(28 * 28),
  left: 0,
  top: 28,
  advance: 28,
};

describe('TextAtlasPages slots', () => {
  it('places a page the atlas opened before the pages sync, where sync keeps it', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, budgetBytes: 32 * 32 * 8 });
    const pages = new TextAtlasPages(new FakeGpuBackend(), atlas, 8);
    const first = atlas.insert('face', 1, BASE_TIER, PAGE_GLYPH)?.pageId ?? -1;
    pages.sync();
    // Records are written as glyphs land, before the frame's sync makes the new page's texture.
    const second = atlas.insert('face', 2, BASE_TIER, PAGE_GLYPH)?.pageId ?? -1;
    expect(pages.placementOf(second)).toEqual({ group: 0, index: 1 });
    pages.sync();
    expect(pages.placementOf(first)).toEqual({ group: 0, index: 0 });
    expect(pages.placementOf(second)).toEqual({ group: 0, index: 1 });
    pages.destroy();
  });

  it('rejects a page group it cannot bind', () => {
    const backend = new FakeGpuBackend();
    expect(() => new TextAtlasPages(backend, new GlyphAtlas(), 0)).toThrow(RangeError);
    expect(() => new TextAtlasPages(backend, new GlyphAtlas(), 9)).toThrow(RangeError);
  });
});

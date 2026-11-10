import { bench, describe } from 'vitest';

import { GlyphAtlas } from './glyph-atlas.js';
import type { GlyphBitmap } from './glyph-bitmap.js';
import { BASE_TIER } from './glyph-tiers.js';

// Gated by `pnpm bench:ci` (its micro-benchmark suite).

/**
 * Makes a base-tier glyph: about 0.7 em square at 64 px per em, plus the 8 px field padding.
 *
 * @param index - Varies the size a little from glyph to glyph.
 * @returns The bitmap.
 */
function glyph(index: number): GlyphBitmap {
  const width = 40 + (index % 17);
  const height = 50 + (index % 13);
  return {
    field: 'msdf',
    width,
    height,
    pixels: new Uint8Array(width * height * 3).fill(128),
    left: -8,
    top: 54,
    advance: 36,
  };
}

const GLYPH_COUNT = 1000;
const glyphs = [...Array(GLYPH_COUNT).keys()].map(glyph);

describe('GlyphAtlas, 1k base-tier MSDF glyphs', () => {
  bench('insert into an empty atlas and take the uploads', () => {
    const atlas = new GlyphAtlas();
    glyphs.forEach((bitmap, codepoint) =>
      atlas.insert('400|n|Bench', codepoint, BASE_TIER, bitmap),
    );
    atlas.takeUploads();
  });

  bench('insert under a one-page budget, evicting least recently used glyphs', () => {
    const atlas = new GlyphAtlas({ pageSize: 1024, budgetBytes: 1024 * 1024 * 4 });
    glyphs.forEach((bitmap, codepoint) => {
      if (codepoint % 100 === 0) atlas.beginFrame();
      atlas.insert('400|n|Bench', codepoint, BASE_TIER, bitmap);
    });
    atlas.takeUploads();
  });

  bench('look up 1k resident glyphs', () => {
    const atlas = new GlyphAtlas();
    glyphs.forEach((bitmap, codepoint) =>
      atlas.insert('400|n|Bench', codepoint, BASE_TIER, bitmap),
    );
    atlas.beginFrame();
    for (let codepoint = 0; codepoint < GLYPH_COUNT; codepoint += 1) {
      atlas.lookup('400|n|Bench', codepoint, BASE_TIER);
    }
  });
});

import { describe, expect, it } from 'vitest';

import { GlyphAtlas } from '../text/atlas/glyph-atlas.js';
import { BASE_TIER } from '../text/atlas/glyph-tiers.js';

import { GLYPH_ATLAS_OWNER, reportGlyphAtlasMemory } from './glyph-atlas-memory.js';
import { MemoryLedger } from './memory-ledger.js';

const PAGE = 64;

function glyph(): Parameters<GlyphAtlas['insert']>[3] {
  return {
    field: 'msdf',
    width: 4,
    height: 3,
    pixels: new Uint8Array(4 * 3 * 3).fill(200),
    left: 0,
    top: 0,
    advance: 5,
  };
}

describe('reportGlyphAtlasMemory', () => {
  it('reports the atlas pages under atlases as glyph-atlas, following pages as they come and go', () => {
    const atlas = new GlyphAtlas({ pageSize: PAGE });
    const ledger = new MemoryLedger();
    reportGlyphAtlasMemory(atlas, ledger);
    expect(ledger.ownersOf('atlases')).toEqual(new Map([[GLYPH_ATLAS_OWNER, 0]]));
    atlas.insert('400|n|Fake', 65, BASE_TIER, glyph());
    reportGlyphAtlasMemory(atlas, ledger);
    expect(ledger.bytesOf('atlases')).toBe(PAGE * PAGE * 4);
    expect(ledger.bytesOf('atlases')).toBe(atlas.memory().residentBytes);
    atlas.clear();
    reportGlyphAtlasMemory(atlas, ledger);
    expect(ledger.bytesOf('atlases')).toBe(0);
  });
});

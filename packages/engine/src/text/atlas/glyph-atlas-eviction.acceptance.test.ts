import { describe, expect, it, vi } from 'vitest';

import { GlyphAtlas } from './glyph-atlas.js';
import { BASE_TIER } from './glyph-tiers.js';

const BITMAP = {
  field: 'sdf' as const,
  width: 14,
  height: 14,
  pixels: new Uint8Array(14 * 14),
  left: 0,
  top: 14,
  advance: 14,
};

describe('GlyphAtlas.onEvict', () => {
  it('reports each LRU glyph with its original placement and no other removal', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, budgetBytes: 32 * 32 });
    const onEvict = vi.fn();
    atlas.onEvict = onEvict;
    const first = atlas.insert('face', 1, BASE_TIER, BITMAP);
    const second = atlas.insert('face', 2, BASE_TIER, BITMAP);
    atlas.insert('face', 3, BASE_TIER, BITMAP);
    atlas.insert('face', 4, BASE_TIER, BITMAP);
    expect(onEvict).not.toHaveBeenCalled();

    atlas.beginFrame();
    atlas.lookup('face', 3, BASE_TIER);
    atlas.lookup('face', 4, BASE_TIER);
    atlas.insert('face', 5, BASE_TIER, BITMAP);
    atlas.insert('face', 6, BASE_TIER, BITMAP);
    expect(onEvict.mock.calls).toEqual([[first], [second]]);
    expect(first).toMatchObject({ pageId: 0, u0: 1 / 32, v0: 1 / 32 });
    expect(second).toMatchObject({ pageId: 0, u0: 17 / 32, v0: 1 / 32 });

    atlas.clear();
    expect(onEvict).toHaveBeenCalledTimes(2);
    atlas.insert('face', 7, BASE_TIER, BITMAP);
    expect(onEvict).toHaveBeenCalledTimes(2);
  });
});

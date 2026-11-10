import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { GlyphAtlas, type AtlasGlyph } from '../atlas/glyph-atlas.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';

import type { PagedGlyphQuad } from './ordered-glyph-quads.js';
import { TextAtlasChanges } from './text-atlas-changes.js';

const BITMAP = {
  field: 'sdf' as const,
  width: 14,
  height: 14,
  pixels: new Uint8Array(14 * 14),
  left: 0,
  top: 14,
  advance: 14,
};

/**
 * A one-page atlas holding four 16-texel cells.
 *
 * @returns The atlas.
 */
function onePage(): GlyphAtlas {
  return new GlyphAtlas({ pageSize: 32, budgetBytes: 32 * 32 });
}

/**
 * A quad sampling the given atlas cell.
 *
 * @param glyph - The placed glyph.
 * @returns Its sampling quad.
 * @throws {Error} When the glyph has no page.
 */
function quad(glyph: AtlasGlyph): PagedGlyphQuad {
  if (glyph.pageId === undefined) throw new Error('Expected a placed glyph');
  return {
    pageId: glyph.pageId,
    quad: {
      x: 0,
      y: 0,
      width: 14,
      height: 14,
      u0: glyph.u0,
      v0: glyph.v0,
      u1: glyph.u1,
      v1: glyph.v1,
      color: [0, 0, 0, 1],
    },
  };
}

/**
 * A placed glyph, failing clearly if atlas allocation changes.
 *
 * @param atlas - The atlas to insert into.
 * @param id - The glyph key.
 * @returns The placed glyph.
 * @throws {Error} When the atlas has no room.
 */
function insert(atlas: GlyphAtlas, id: number): AtlasGlyph {
  const glyph = atlas.insert('face', id, BASE_TIER, BITMAP);
  if (glyph === undefined) throw new Error('Expected room for glyph');
  return glyph;
}

describe('TextAtlasChanges.collect', () => {
  it('stales only texts sampling evicted cells, excluding another cell on the same page and Greek text', () => {
    const atlas = onePage();
    const changes = new TextAtlasChanges(atlas);
    const first = insert(atlas, 1);
    const second = insert(atlas, 2);
    insert(atlas, 3);
    insert(atlas, 4);
    const entries = new Map([
      ['a' as ObjectId, { isGreek: false, quads: { quads: [quad(first)] } }],
      ['b' as ObjectId, { isGreek: false, quads: { quads: [quad(second)] } }],
      ['greek' as ObjectId, { isGreek: true, quads: { quads: [quad(first)] } }],
    ]);
    changes.collect(entries, new Set(), new Set());
    atlas.beginFrame();
    atlas.lookup('face', 2, BASE_TIER);
    atlas.lookup('face', 3, BASE_TIER);
    atlas.lookup('face', 4, BASE_TIER);
    insert(atlas, 5);
    const stale = new Set<ObjectId>();
    changes.collect(entries, new Set(), stale);
    expect([...stale]).toEqual(['a']);
    expect(first.pageId).toBe(second.pageId);
    expect(first.u0).not.toBe(second.u0);

    const next = new Set<ObjectId>();
    changes.collect(entries, new Set(), next);
    expect([...next]).toEqual([]);
    atlas.onEvict = undefined;
    atlas.beginFrame();
    insert(atlas, 6);
    changes.collect(entries, new Set(), next);
    expect([...next]).toEqual(['a', 'b']);
  });

  it('stales incomplete texts after inserts without eviction', () => {
    const atlas = onePage();
    const changes = new TextAtlasChanges(atlas);
    const entries = new Map([
      ['waiting' as ObjectId, { isGreek: false }],
      ['complete' as ObjectId, { isGreek: false }],
    ]);
    insert(atlas, 1);
    const stale = new Set<ObjectId>();
    changes.collect(entries, new Set(['waiting' as ObjectId]), stale);
    expect([...stale]).toEqual(['waiting']);
  });

  it('falls back to every non-Greek text when the eviction count moves unseen', () => {
    const atlas = onePage();
    const changes = new TextAtlasChanges(atlas);
    for (const id of [1, 2, 3, 4]) insert(atlas, id);
    changes.collect(new Map(), new Set(), new Set());
    atlas.onEvict = undefined;
    atlas.beginFrame();
    insert(atlas, 5);
    const entries = new Map([
      ['a' as ObjectId, { isGreek: false }],
      ['b' as ObjectId, { isGreek: false }],
      ['greek' as ObjectId, { isGreek: true }],
    ]);
    const stale = new Set<ObjectId>();
    changes.collect(entries, new Set(), stale);
    expect([...stale]).toEqual(['a', 'b']);
  });
});

import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import { layoutText } from '@canvas/text';

import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import type { GlyphBitmap, GlyphField } from '../atlas/glyph-bitmap.js';
import { MAX_TIER } from '../atlas/glyph-tiers.js';
import { FakeGlyphMeasurer } from '../layout/__fixtures__/fake-glyph-measurer.js';

import { localQuadBounds } from './drawn-text-bounds.js';
import { orderedGlyphQuads, type VectorGlyphPolicy } from './ordered-glyph-quads.js';
import type { TextObjectEntry } from './text-object-entry.js';

const FACE = '400|n|Fake';
/** 64 px text at 10×: 640 device px per em, the vector tier. */
const PLACEMENT = { originX: 0, originY: 0, scale: 10 };
const STYLE: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 64,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const LAYOUT = layoutText('AB', [{ length: 2, style: STYLE }], null, new FakeGlyphMeasurer());
const READY: VectorGlyphPolicy = { revision: 0, isRunReady: () => true };

function bitmap(field: GlyphField): GlyphBitmap {
  const channels = field === 'sdf' ? 1 : 4;
  return {
    field,
    width: 4,
    height: 4,
    pixels: new Uint8Array(4 * 4 * channels),
    left: 0,
    top: 4,
    advance: 4,
  };
}

describe('orderedGlyphQuads with the vector tier', () => {
  it('draws a ready run from its outlines once its glyphs are in the atlas', () => {
    const atlas = new GlyphAtlas();
    atlas.insert(FACE, 0x41, MAX_TIER, bitmap('sdf'));
    atlas.insert(FACE, 0x42, MAX_TIER, bitmap('sdf'));
    const quads = orderedGlyphQuads(LAYOUT, PLACEMENT, atlas, undefined, undefined, READY);
    expect(quads.tiers).toEqual(['vector']);
    expect(quads.vectorRuns).toEqual([0]);
    expect(quads.quads).toEqual([undefined, undefined]);
    // Its glyphs' 512-tier quads stand for its drawing bounds: 4 texels at 64/512 per texel.
    const [first, second] = LAYOUT.glyphs;
    expect(quads.vectorBounds).toEqual({
      minX: first?.x,
      minY: (first?.y ?? 0) - 0.5,
      maxX: (second?.x ?? 0) + 0.5,
      maxY: first?.y,
    });
    expect(localQuadBounds({ quads } as TextObjectEntry)).toEqual(quads.vectorBounds);
  });

  it('keeps a ready run on the atlas while one of its glyphs is not in it', () => {
    const atlas = new GlyphAtlas();
    atlas.insert(FACE, 0x41, MAX_TIER, bitmap('sdf'));
    const quads = orderedGlyphQuads(LAYOUT, PLACEMENT, atlas, undefined, undefined, READY);
    expect(quads.vectorRuns).toEqual([]);
    expect(quads.isComplete).toBe(false);
    expect(quads.quads[0]).toBeDefined();
  });

  it('keeps a run with a colour glyph on the atlas: an emoji is never filled as an outline', () => {
    const atlas = new GlyphAtlas();
    atlas.insert(FACE, 0x41, MAX_TIER, bitmap('sdf'));
    atlas.insert(FACE, 0x42, MAX_TIER, bitmap('colour'));
    const quads = orderedGlyphQuads(LAYOUT, PLACEMENT, atlas, undefined, undefined, READY);
    expect(quads.vectorRuns).toEqual([]);
    expect(quads.quads.every((quad) => quad !== undefined)).toBe(true);
  });

  it('counts each glyph of a run drawn from its outlines as one lookup and no miss', () => {
    const atlas = new GlyphAtlas();
    atlas.insert(FACE, 0x41, MAX_TIER, bitmap('sdf'));
    atlas.insert(FACE, 0x42, MAX_TIER, bitmap('sdf'));
    const counts = { lookups: 0, misses: 0 };
    const quads = orderedGlyphQuads(LAYOUT, PLACEMENT, atlas, undefined, counts, READY);
    expect(quads.vectorRuns).toEqual([0]);
    expect(counts).toEqual({ lookups: 2, misses: 0 });
    // A run the atlas still has to draw is counted by the atlas path alone, once a glyph.
    const missing = { lookups: 0, misses: 0 };
    const pending = new GlyphAtlas();
    pending.insert(FACE, 0x41, MAX_TIER, bitmap('sdf'));
    orderedGlyphQuads(LAYOUT, PLACEMENT, pending, undefined, missing, READY);
    expect(missing).toEqual({ lookups: 2, misses: 1 });
  });

  it('falls back to, and checks, the highest tier a small atlas holds', () => {
    const atlas = new GlyphAtlas({ pageSize: 256 });
    const tier = atlas.maxTier;
    expect(tier).toBeLessThan(MAX_TIER);
    atlas.insert(FACE, 0x41, tier, bitmap('sdf'));
    // Not every glyph in at the capped tier yet: the run draws from the atlas at that tier.
    const pending = orderedGlyphQuads(LAYOUT, PLACEMENT, atlas, undefined, undefined, READY);
    expect(pending.tiers).toEqual(['vector']);
    expect(pending.maxTier).toBe(tier);
    expect(pending.vectorRuns).toEqual([]);
    atlas.insert(FACE, 0x42, tier, bitmap('sdf'));
    const ready = orderedGlyphQuads(LAYOUT, PLACEMENT, atlas, undefined, undefined, READY);
    expect(ready.vectorRuns).toEqual([0]);
    // 4 texels at 64 px per `tier` texels.
    const [first] = LAYOUT.glyphs;
    expect(ready.vectorBounds?.minY).toBeCloseTo((first?.y ?? 0) - (4 * 64) / tier);
  });
});

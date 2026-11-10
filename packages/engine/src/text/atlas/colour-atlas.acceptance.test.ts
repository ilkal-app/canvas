import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { textPageUniform } from '../renderer/text-pipeline.js';

import { cellTexels } from './atlas-upload.js';
import { GLYPH_ATLAS_GUTTER, GlyphAtlas } from './glyph-atlas.js';
import type { GlyphBitmap } from './glyph-bitmap.js';
import { BASE_TIER } from './glyph-tiers.js';

function bitmap(field: GlyphBitmap['field'] | 'colour', pixels: number[]): GlyphBitmap {
  return {
    field,
    width: 2,
    height: 1,
    pixels: Uint8Array.from(pixels),
    left: -8,
    top: 72,
    advance: 64,
  };
}

describe('colour atlas pages', () => {
  it('keeps colour RGBA pages separate from MSDF RGBA and SDF R8 pages', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, budgetBytes: 32 * 32 * 9 });
    const msdf = atlas.insert('face', 1, BASE_TIER, bitmap('msdf', [1, 2, 3, 4, 5, 6]));
    const colour = atlas.insert(
      'face',
      2,
      BASE_TIER,
      bitmap('colour', [128, 0, 0, 128, 0, 0, 0, 0]),
    );
    const secondColour = atlas.insert(
      'face',
      3,
      BASE_TIER,
      bitmap('colour', [0, 0, 255, 255, 0, 0, 0, 0]),
    );
    const sdf = atlas.insert('face', 4, BASE_TIER, bitmap('sdf', [100, 200]));
    expect(msdf?.pageId).toBeDefined();
    expect(colour?.pageId).toBeDefined();
    expect(colour?.pageId).toBe(secondColour?.pageId);
    expect(colour?.pageId).not.toBe(msdf?.pageId);
    expect(sdf?.pageId).not.toBe(colour?.pageId);
    expect(atlas.pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: msdf?.pageId, field: 'msdf', format: 'rgba8unorm' }),
        expect.objectContaining({ id: colour?.pageId, field: 'colour', format: 'rgba8unorm' }),
        expect.objectContaining({ id: sdf?.pageId, field: 'sdf', format: 'r8unorm' }),
      ]),
    );
  });

  it('copies premultiplied RGBA rows unchanged with a transparent gutter', () => {
    const source = bitmap('colour', [128, 0, 0, 128, 0, 0, 255, 64]);
    const texels = cellTexels(source, 'rgba8unorm', GLYPH_ATLAS_GUTTER);
    expect(texels).toHaveLength(4 * 3 * 4);
    expect([...texels.slice(0, 4 * 4)]).toEqual(Array(16).fill(0));
    expect([...texels.slice(4 * 4, 4 * 8)]).toEqual([
      0, 0, 0, 0, 128, 0, 0, 128, 0, 0, 255, 64, 0, 0, 0, 0,
    ]);
    expect([...texels.slice(4 * 8)]).toEqual(Array(16).fill(0));
  });

  it('encodes page mode 0 for MSDF, 1 for SDF, and 2 for colour', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, budgetBytes: 32 * 32 * 9 });
    atlas.insert('face', 1, BASE_TIER, bitmap('msdf', [1, 2, 3, 4, 5, 6]));
    atlas.insert('face', 2, BASE_TIER, bitmap('sdf', [100, 200]));
    atlas.insert('face', 3, BASE_TIER, bitmap('colour', [128, 0, 0, 128, 0, 0, 0, 0]));
    expect(atlas.pages.map((page) => [page.field as string, textPageUniform(page)[3]])).toEqual([
      ['msdf', 0],
      ['sdf', 1],
      ['colour', 2],
    ]);
  });

  it('uses sampled premultiplied colour with run alpha and clip coverage in the scene shader', () => {
    const shader = readFileSync(
      new URL('../../gpu/shaders/scene-text.wgsl', import.meta.url),
      'utf8',
    );
    expect(shader).toMatch(/page\.\w+\s*(?:==\s*2\.0|>\s*1\.5)/);
    expect(shader).toContain('texel');
    expect(shader).toContain('input.color.a');
    expect(shader).toMatch(/clipCoverage\(/);
  });
});

import { describe, expect, it, vi } from 'vitest';

import * as engine from '../../index.js';
import { FakeGpuBackend } from '../../scene/__fixtures__/fake-gpu-backend.js';
import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';
import { TEXT_BINDINGS, TEXT_PAGE_UNIFORM_BYTES } from '../renderer/text-pipeline.js';

import { TextAtlasPages } from './text-atlas-pages.js';

const BITMAP = {
  field: 'sdf' as const,
  width: 24,
  height: 24,
  pixels: new Uint8Array(24 * 24).fill(200),
  left: 0,
  top: 24,
  advance: 24,
};
const PAGES_PER_GROUP = 8;
type GroupedPages = TextAtlasPages & {
  placementOf(pageId: number): { group: number; index: number };
};
const GROUPED_TEXT_ATLAS_PAGES = TextAtlasPages as unknown as new (
  backend: FakeGpuBackend,
  atlas: GlyphAtlas,
  pagesPerGroup?: number,
) => GroupedPages;

/**
 * Adds one glyph that occupies a whole 32 px atlas page.
 *
 * @param atlas - The test atlas.
 * @param key - The glyph key.
 * @returns Its page id.
 * @throws {Error} If the atlas rejects the fixture glyph.
 */
function addPage(atlas: GlyphAtlas, key: number): number {
  const pageId = atlas.insert('face', key, BASE_TIER, BITMAP)?.pageId;
  if (pageId === undefined) throw new Error('The fixture glyph did not get a page.');
  return pageId;
}

describe('TextAtlasPages page groups', () => {
  it('exports an eight-page group', () => {
    expect(engine).toHaveProperty('TEXT_PAGES_PER_GROUP', PAGES_PER_GROUP);
  });

  it('gives new pages the lowest free stable slot', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, budgetBytes: 32 * 32 * 10 });
    const pages = new GROUPED_TEXT_ATLAS_PAGES(new FakeGpuBackend(), atlas, PAGES_PER_GROUP);
    const ids = Array.from({ length: 9 }, (value, key) => addPage(atlas, key));
    pages.sync();
    expect(ids.map((id) => pages.placementOf(id))).toEqual([
      ...Array.from({ length: 8 }, (value, index) => ({ group: 0, index })),
      { group: 1, index: 0 },
    ]);
    expect(pages.placementOf(-1)).toEqual({ group: 0, index: 0 });

    atlas.beginFrame(16);
    atlas.insert('face', 1, BASE_TIER, { ...BITMAP, width: 0, height: 0 });
    pages.sync();
    expect(pages.placementOf(ids[1] ?? -1)).toEqual({ group: 0, index: 0 });
    const replacement = addPage(atlas, 9);
    pages.sync();
    expect(replacement).not.toBe(ids[1]);
    expect(pages.placementOf(replacement)).toEqual({ group: 0, index: 1 });
    expect(pages.placementOf(ids[8] ?? -1)).toEqual({ group: 1, index: 0 });
    pages.destroy();
  });

  it('binds one group uniform, every page texture with blank gaps, and the sampler', () => {
    const atlas = new GlyphAtlas({ pageSize: 32, budgetBytes: 32 * 32 * 10 });
    const backend = new FakeGpuBackend();
    const pages = new GROUPED_TEXT_ATLAS_PAGES(backend, atlas, PAGES_PER_GROUP);
    const writes = vi.spyOn(backend, 'writeBuffer');
    const first = addPage(atlas, 0);
    const second = addPage(atlas, 1);
    const third = addPage(atlas, 2);
    pages.sync();
    atlas.insert('face', 1, BASE_TIER, { ...BITMAP, width: 0, height: 0 });
    pages.sync();
    const entries = pages.entriesOf(0);
    const uniforms = entries.filter((entry) => 'buffer' in entry);
    const textures = entries.filter((entry) => 'texture' in entry);
    const samplers = entries.filter((entry) => 'sampler' in entry);
    expect(uniforms).toHaveLength(1);
    expect(uniforms[0]?.binding).toBe(TEXT_BINDINGS.page);
    expect(uniforms[0] && 'buffer' in uniforms[0] ? uniforms[0].buffer.byteLength : 0).toBe(
      PAGES_PER_GROUP * TEXT_PAGE_UNIFORM_BYTES,
    );
    expect(textures).toHaveLength(PAGES_PER_GROUP);
    expect(textures[0] && 'texture' in textures[0] ? textures[0].texture.width : 0).toBe(32);
    expect(textures[1] && 'texture' in textures[1] ? textures[1].texture.width : 0).toBe(1);
    expect(textures[2] && 'texture' in textures[2] ? textures[2].texture.width : 0).toBe(32);
    expect(textures[0] && 'texture' in textures[0] ? textures[0].texture : undefined).not.toBe(
      textures[2] && 'texture' in textures[2] ? textures[2].texture : undefined,
    );
    const groupUniform = uniforms[0] && 'buffer' in uniforms[0] ? uniforms[0].buffer : undefined;
    const groupWrites = writes.mock.calls.filter(([buffer]) => buffer === groupUniform);
    const latest = groupWrites.at(-1)?.[2];
    expect(latest).toBeDefined();
    const values = latest === undefined ? [] : [...(latest as Float32Array)];
    expect(values.slice(0, 4)).toEqual([32, 32, expect.any(Number), 1]);
    expect(values.slice(4, 8)).toEqual([1, 1, expect.any(Number), 1]);
    expect(values.slice(8, 12)).toEqual([32, 32, expect.any(Number), 1]);
    expect(samplers).toHaveLength(1);
    expect(samplers[0]?.binding).toBe(TEXT_BINDINGS.sampler);
    expect(pages.placementOf(first)).toEqual({ group: 0, index: 0 });
    expect(pages.placementOf(second)).toEqual({ group: 0, index: 0 });
    expect(pages.placementOf(third)).toEqual({ group: 0, index: 2 });
    writes.mockRestore();
    pages.destroy();
  });

  it('keeps the one-page default: separate groups for separate live pages', () => {
    const atlas = new GlyphAtlas({ pageSize: 32 });
    const pages = new GROUPED_TEXT_ATLAS_PAGES(new FakeGpuBackend(), atlas);
    const first = addPage(atlas, 0);
    const second = addPage(atlas, 1);
    pages.sync();
    expect(pages.placementOf(first)).toEqual({ group: 0, index: 0 });
    expect(pages.placementOf(second)).toEqual({ group: 1, index: 0 });
    expect(pages.entriesOf(1).filter((entry) => 'texture' in entry)).toHaveLength(1);
    pages.destroy();
  });
});

import { afterEach, expect, it, vi } from 'vitest';

import { FakeGpuBackend } from '../../scene/__fixtures__/fake-gpu-backend.js';
import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';

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
afterEach(() => vi.restoreAllMocks());

it('refuses new glyphs and actual eviction until the corresponding uploads complete', () => {
  const atlas = new GlyphAtlas({ pageSize: 32, budgetBytes: 32 * 32 });
  const pages = new TextAtlasPages(new FakeGpuBackend(), atlas);
  expect(pages.uploadedRevision).toBeUndefined();
  atlas.beginFrame(0);
  expect(atlas.insert('face', 65, BASE_TIER, BITMAP)).toBeDefined();
  pages.sync();
  expect(pages.uploadedRevision).toBe(atlas.revision);
  atlas.beginFrame(16);
  expect(atlas.insert('face', 66, BASE_TIER, BITMAP)).toBeDefined();
  expect(atlas.memory().evictedGlyphCount).toBe(1);
  expect(pages.uploadedRevision).not.toBe(atlas.revision);
  pages.sync();
  expect(pages.uploadedRevision).toBe(atlas.revision);
  pages.destroy();
  expect(pages.uploadedRevision).toBeUndefined();
});

it('never certifies lost uploads after a backend upload throws, even if a later sync succeeds', () => {
  const atlas = new GlyphAtlas({ pageSize: 32 });
  const backend = new FakeGpuBackend();
  const pages = new TextAtlasPages(backend, atlas);
  pages.sync();
  atlas.insert('face', 65, BASE_TIER, BITMAP);
  vi.spyOn(backend, 'writeTexture').mockImplementationOnce(() => {
    throw new Error('upload failed');
  });
  expect(() => {
    pages.sync();
  }).toThrow('upload failed');
  expect(pages.uploadedRevision).toBeUndefined();
  pages.sync();
  expect(pages.uploadedRevision).toBeUndefined();
  pages.destroy();
});

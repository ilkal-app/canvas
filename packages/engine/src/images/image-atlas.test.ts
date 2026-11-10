import { describe, expect, it } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';

import { ATLAS_MAX_ITEM_PX, ImageAtlas } from './image-atlas.js';
import { PLACEHOLDER_PAGE, TexturePages } from './texture-pages.js';

function createAtlas(pageSize = 512): { atlas: ImageAtlas; backend: FakeGpuBackend } {
  const backend = new FakeGpuBackend();
  const atlas = new ImageAtlas(backend, new TexturePages(backend), pageSize);
  return { atlas, backend };
}

describe('ImageAtlas', () => {
  it('takes items up to 256 px a side and nothing larger', () => {
    const { atlas } = createAtlas();

    expect(ATLAS_MAX_ITEM_PX).toBe(256);
    expect(atlas.isSmall(256, 200)).toBe(true);
    expect(atlas.isSmall(257, 100)).toBe(false);
  });

  it('packs twenty small images onto one page', () => {
    const { atlas, backend } = createAtlas(1024);

    const entries = Array.from({ length: 20 }, () => atlas.allocate(128, 96, true));

    expect(entries.every((entry) => entry !== undefined)).toBe(true);
    expect(new Set(entries.map((entry) => entry?.page)).size).toBe(1);
    expect(entries[0]?.page).not.toBe(PLACEHOLDER_PAGE);
    expect(atlas.pageCount).toBe(1);
    expect(atlas.bytes).toBe(1024 * 1024 * 4);
    expect(backend.liveTextures().map(({ label }) => label)).toEqual([
      'image placeholder',
      'image atlas 0',
    ]);
  });

  it('gives no two entries overlapping texels', () => {
    const { atlas } = createAtlas(512);
    const entries = Array.from({ length: 12 }, (unused, index) =>
      atlas.allocate(100 + index * 5, 90, true),
    ).filter((entry) => entry !== undefined);

    for (const [index, a] of entries.entries()) {
      for (const b of entries.slice(index + 1)) {
        const isApart =
          a.page !== b.page ||
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(isApart).toBe(true);
      }
    }
  });

  it('opens another page only when allowed', () => {
    const { atlas } = createAtlas(256);
    atlas.allocate(256, 256, true);

    expect(atlas.allocate(64, 64, false)).toBeUndefined();
    expect(atlas.allocate(64, 64, true)?.page).toBeDefined();
    expect(atlas.pageCount).toBe(2);
  });

  it('reuses the room a released entry leaves', () => {
    const { atlas } = createAtlas(256);
    const first = atlas.allocate(256, 128, true);
    atlas.allocate(256, 128, true);
    if (first === undefined) throw new Error('no room');

    atlas.release(first);

    expect(atlas.allocate(256, 128, false)).toMatchObject({ x: 0, y: 0 });
  });

  it('destroys a page once its last entry is released', () => {
    const { atlas, backend } = createAtlas(256);
    const only = atlas.allocate(64, 64, true);
    if (only === undefined) throw new Error('no room');

    atlas.release(only);

    expect(atlas.pageCount).toBe(0);
    expect(atlas.bytes).toBe(0);
    expect(backend.liveTextures().map(({ label }) => label)).toEqual(['image placeholder']);
  });

  it('uploads an entry into its own rectangle of the page', () => {
    const { atlas, backend } = createAtlas(256);
    const entry = atlas.allocate(10, 5, true);
    if (entry === undefined) throw new Error('no room');
    backend.resetCalls();

    atlas.upload(entry, new Uint8Array(10 * 5 * 4));

    expect(backend.calls).toEqual([
      { method: 'writeTexture', label: 'image atlas 0', byteLength: 200 },
    ]);
  });

  it('ignores an entry released twice, and refuses one on a page that is gone', () => {
    const { atlas } = createAtlas(256);
    const kept = atlas.allocate(64, 64, true);
    const released = atlas.allocate(64, 64, true);
    if (kept === undefined || released === undefined) throw new Error('no room');
    atlas.release(released);

    atlas.release(released);

    expect(atlas.pageCount).toBe(1);
    expect(() => {
      atlas.release({ ...kept, page: 99 });
    }).toThrow(RangeError);
  });
});

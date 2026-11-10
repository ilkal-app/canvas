import { describe, expect, it, vi } from 'vitest';

import { MemoryLedger, type MemoryCategory } from '../diagnostics/memory-ledger.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import type { DecodedLevel } from '../workers/job-kinds.js';

import { IMAGE_ATLAS_OWNER, IMAGE_LEVELS_OWNER, TextureResidency } from './texture-residency.js';

const MIB = 1024 * 1024;

/**
 * A blank level of a size.
 *
 * @param widthPx - Its width, px.
 * @param heightPx - Its height, px.
 * @returns The level.
 */
function level(widthPx: number, heightPx = widthPx): DecodedLevel {
  return { widthPx, heightPx, rgba: new Uint8Array(widthPx * heightPx * 4) };
}

/**
 * A residency over the fake backend, recording its evictions.
 *
 * @param budgetBytes - Its budget.
 * @param maxTextureSize - The backend's texture limit.
 * @returns The residency, its ledger and the evicted keys.
 */
function residencyOf(budgetBytes: number, maxTextureSize = 8192) {
  const ledger = new MemoryLedger();
  const evicted: string[] = [];
  const backend = new FakeGpuBackend({ maxTextureSize });
  const residency = new TextureResidency(backend, ledger, budgetBytes, (key) => evicted.push(key));
  return { residency, ledger, evicted, backend };
}

const NEEDS_NOTHING = (): boolean => false;

describe('TextureResidency', () => {
  it('gives a large level a texture of its own and packs a small one onto an atlas page', () => {
    const { residency, ledger } = residencyOf(64 * MIB);

    const large = residency.upload('photo|L512', level(512), 0, NEEDS_NOTHING);
    const small = residency.upload('photo|L128', level(128), 0, NEEDS_NOTHING);

    expect(large).toMatchObject({ entry: undefined, bytes: MIB });
    expect(small).toMatchObject({ texture: undefined, bytes: 128 * 128 * 4 });
    const owners = ledger.ownersOf('textures');
    expect(owners.get(IMAGE_LEVELS_OWNER)).toBe(MIB);
    expect(owners.get(IMAGE_ATLAS_OWNER)).toBe(2048 * 2048 * 4);
  });

  it('refuses a level larger than the GPU can hold', () => {
    const { residency } = residencyOf(64 * MIB, 1024);

    expect(residency.upload('huge|L2048', level(2048, 1024), 0, NEEDS_NOTHING)).toBe('too-large');
  });

  it('evicts idle levels, larger first, to make room, and never a needed one', () => {
    const { residency, evicted } = residencyOf(2.5 * MIB);
    residency.upload('a|L512', level(512), 0, NEEDS_NOTHING);
    residency.upload('b|L1024', level(1024, 256), 1, NEEDS_NOTHING);
    const isNeeded = (key: string): boolean => key === 'b|L1024';

    const placed = residency.upload('c|L512', level(512), 2, isNeeded);

    expect(typeof placed).toBe('object');
    expect(evicted).toEqual(['a|L512']);
    expect(residency.keys()).toEqual(['b|L1024', 'c|L512']);
  });

  it('refuses a level when only needed levels fill the budget', () => {
    const { residency } = residencyOf(1.5 * MIB);
    residency.upload('a|L512', level(512), 0, NEEDS_NOTHING);

    const refused = residency.upload('b|L512', level(512), 1, () => true);

    expect(refused).toBe('over-budget');
    expect(residency.get('a|L512')).toBeDefined();
  });

  it('frees an evicted atlas level once, and says a second eviction freed nothing', () => {
    const { residency, evicted } = residencyOf(64 * MIB);
    const placed = residency.upload('photo|L128', level(128), 0, NEEDS_NOTHING);
    if (typeof placed === 'string') throw new Error(placed);

    expect(residency.evict('photo|L128')).toBe(true);
    expect(residency.evict('photo|L128')).toBe(false);
    expect(evicted).toEqual(['photo|L128']);
    expect(residency.keyAt(placed.region)).toBe('gone');
  });

  it('evicts every idle level after an allocation failure, keeping the needed ones', () => {
    const { residency } = residencyOf(64 * MIB);
    residency.upload('a|L512', level(512), 0, NEEDS_NOTHING);
    residency.upload('b|L512', level(512), 0, NEEDS_NOTHING);
    residency.upload('c|L128', level(128), 0, NEEDS_NOTHING);

    const count = residency.evictIdle((key) => key === 'b|L512');

    expect(count).toBe(2);
    expect(['a|L512', 'b|L512', 'c|L128'].map((key) => residency.get(key) !== undefined)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('frees idle atlas levels when a full page at the budget has no room for another', () => {
    // One atlas page (16 MiB) fits the budget; sixty-four 256 px levels fill it.
    const { residency, evicted } = residencyOf(16 * MIB);
    for (let index = 0; index < 64; index += 1) {
      residency.upload(`a${String(index)}|L256`, level(256), index, NEEDS_NOTHING);
    }

    const placed = residency.upload('late|L256', level(256), 64, NEEDS_NOTHING);
    const refused = residency.upload('later|L256', level(256), 65, () => true);

    expect(typeof placed).toBe('object');
    expect(evicted).toEqual(['a0|L256']);
    expect(refused).toBe('over-budget');
  });

  it('evicts nothing when evicting every idle level would still not make room', () => {
    // A needed atlas page (16 MiB) and an idle 1024² level (4 MiB) under 24 MiB: a needed 9 MiB
    // level would still pass the budget with the idle one gone, so the idle one stays.
    const { residency, evicted } = residencyOf(24 * MIB);
    const needed = (key: string): boolean => key !== 'idle|L1024';
    residency.upload('small|L128', level(128), 0, needed);
    residency.upload('idle|L1024', level(1024), 0, needed);

    const outcome = residency.upload('big|L2048', level(2048, 1152), 1, needed);

    expect(outcome).toBe('over-budget');
    expect(evicted).toEqual([]);
    expect(residency.keys()).toEqual(['small|L128', 'idle|L1024']);
  });
  describe('a new version of a resident level', () => {
    /**
     * What a refused upload must leave alone.
     *
     * @param residency - The residency.
     * @param backend - Its backend.
     * @param key - The resident level's key.
     * @returns The level, its region, the live textures and the bytes.
     */
    function snapshot(
      residency: TextureResidency,
      backend: FakeGpuBackend,
      key: string,
    ): unknown[] {
      return [
        residency.get(key),
        residency.get(key)?.region,
        residency.keys(),
        backend.liveTextures(),
        residency.residentBytes,
      ];
    }

    it('replaces a resident level under a budget that holds only one of its size', () => {
      const { residency, ledger, evicted } = residencyOf(1.5 * MIB);
      residency.upload('a|L512', level(512), 0, NEEDS_NOTHING);

      const replaced = residency.upload('a|L512', level(512), 1, NEEDS_NOTHING);

      expect(typeof replaced).toBe('object');
      expect(evicted).toEqual([]);
      expect(residency.residentBytes).toBe(MIB);
      expect(ledger.ownersOf('textures').get(IMAGE_LEVELS_OWNER)).toBe(MIB);
    });

    it('keeps the resident level, its texture and the accounting when the new one is over budget', () => {
      const { residency, backend, ledger, evicted } = residencyOf(1.5 * MIB);
      residency.upload('a|L512', level(512), 0, NEEDS_NOTHING);
      const before = snapshot(residency, backend, 'a|L512');

      const refused = residency.upload('a|L512', level(1024), 1, NEEDS_NOTHING);

      expect(refused).toBe('over-budget');
      expect(snapshot(residency, backend, 'a|L512')).toEqual(before);
      expect(evicted).toEqual([]);
      expect(ledger.ownersOf('textures').get(IMAGE_LEVELS_OWNER)).toBe(MIB);
    });

    it('keeps the resident level when the new one is larger than the GPU can hold', () => {
      const { residency, backend, ledger } = residencyOf(64 * MIB, 512);
      residency.upload('a|L512', level(512), 0, NEEDS_NOTHING);
      const before = snapshot(residency, backend, 'a|L512');

      const refused = residency.upload('a|L512', level(1024), 1, NEEDS_NOTHING);

      expect(refused).toBe('too-large');
      expect(snapshot(residency, backend, 'a|L512')).toEqual(before);
      expect(ledger.ownersOf('textures').get(IMAGE_LEVELS_OWNER)).toBe(MIB);
    });

    it('keeps the resident level when the backend fails to allocate the new texture', () => {
      const { residency, backend } = residencyOf(64 * MIB);
      residency.upload('a|L512', level(512), 0, NEEDS_NOTHING);
      const before = snapshot(residency, backend, 'a|L512');
      backend.maxLiveTextures = 0;

      const refused = residency.upload('a|L512', level(512), 1, NEEDS_NOTHING);

      expect(refused).toBe('allocation-failed');
      expect(snapshot(residency, backend, 'a|L512')).toEqual(before);
    });

    it('keeps an atlas level and its page when the new version is refused', () => {
      const { residency, backend, ledger } = residencyOf(64 * MIB, 256);
      residency.upload('a|L128', level(128), 0, NEEDS_NOTHING);
      const before = snapshot(residency, backend, 'a|L128');

      const refused = residency.upload('a|L128', level(512), 1, NEEDS_NOTHING);

      expect(refused).toBe('too-large');
      expect(snapshot(residency, backend, 'a|L128')).toEqual(before);
      expect(ledger.ownersOf('textures').get(IMAGE_ATLAS_OWNER)).toBe(256 * 256 * 4);
    });

    it('frees the replaced texture once the new version is resident', () => {
      const { residency, backend } = residencyOf(64 * MIB);
      residency.upload('a|L512', level(512), 0, NEEDS_NOTHING);
      const liveBefore = backend.liveTextures().length;

      residency.upload('a|L512', level(512), 1, NEEDS_NOTHING);

      expect(backend.liveTextures()).toHaveLength(liveBefore);
      expect(residency.residentBytes).toBe(MIB);
    });
  });

  describe('a new version of a level in a full atlas at the budget', () => {
    /**
     * A residency whose one atlas page (16 MiB) fills the budget, with every level idle.
     *
     * @param size - The edge of each level, px.
     * @param count - How many levels fill the page.
     * @returns The residency and its evictions.
     */
    function fullAtlas(size: number, count: number) {
      const made = residencyOf(16 * MIB);
      for (let index = 0; index < count; index += 1) {
        made.residency.upload(
          `e${String(index)}|L${String(size)}`,
          level(size),
          index,
          NEEDS_NOTHING,
        );
      }
      return made;
    }

    it('reuses the rectangle of the old version: nothing is evicted and the new pixels go in', () => {
      const { residency, evicted, backend, ledger } = fullAtlas(256, 64);
      const before = residency.get('e10|L256');
      const write = vi.spyOn(backend as GpuBackend, 'writeTexture');
      const rgba = new Uint8Array(256 * 256 * 4).fill(7);

      const placed = residency.upload(
        'e10|L256',
        { widthPx: 256, heightPx: 256, rgba },
        99,
        NEEDS_NOTHING,
      );

      expect(typeof placed).toBe('object');
      expect(evicted).toEqual([]);
      expect(residency.keys()).toHaveLength(64);
      expect(residency.get('e10|L256')).toMatchObject({
        region: before?.region,
        lastUsedFrame: 99,
      });
      expect(residency.get('e10|L256')).not.toBe(before);
      const { x, y } = before?.entry ?? { x: -1, y: -1 };
      expect(write).toHaveBeenCalledTimes(1);
      expect(write.mock.calls[0]?.[2]).toEqual({ x, y, width: 256, height: 256 });
      const written = write.mock.calls[0]?.[1] as Uint8Array;
      expect([written.byteLength, written[0], written.at(-1)]).toEqual([rgba.byteLength, 7, 7]);
      expect(ledger.ownersOf('textures').get(IMAGE_ATLAS_OWNER)).toBe(16 * MIB);
    });

    it('draws a smaller new version from the top-left of the same rectangle', () => {
      const { residency, evicted } = fullAtlas(256, 64);
      const before = residency.get('e3|L256');

      const placed = residency.upload('e3|L256', level(128), 99, NEEDS_NOTHING);

      expect(evicted).toEqual([]);
      expect(placed).toMatchObject({ widthPx: 128, heightPx: 128 });
      expect(residency.get('e3|L256')?.region).toMatchObject({
        page: before?.region.page,
        u0: before?.region.u0,
        v0: before?.region.v0,
        u1: (before?.region.u0 ?? 0) + 128 / 2048,
      });
      // Freeing it later returns the whole rectangle the level held.
      residency.evict('e3|L256');
      expect(typeof residency.upload('again|L256', level(256), 100, NEEDS_NOTHING)).toBe('object');
      expect(evicted).toEqual(['e3|L256']);
    });

    it('evicts nothing and keeps the old version when the new one fits no rectangle', () => {
      // 256 levels of 128 px fill the page; a 256 px version has no shelf tall enough.
      const { residency, evicted, backend } = fullAtlas(128, 256);
      const before = residency.get('e0|L128');
      const write = vi.spyOn(backend as GpuBackend, 'writeTexture');

      const refused = residency.upload('e0|L128', level(256), 99, NEEDS_NOTHING);

      expect(refused).toBe('over-budget');
      expect(evicted).toEqual([]);
      expect(residency.get('e0|L128')).toBe(before);
      expect(residency.keys()).toHaveLength(256);
      expect(write).not.toHaveBeenCalled();
    });

    it('does not count the page of the replaced level as freeable', () => {
      // The page holds the replaced level and an idle one, so it can never empty: a 4 MiB
      // texture over 16.5 MiB cannot fit, and the idle level must stay.
      const { residency, evicted } = residencyOf(16.5 * MIB);
      residency.upload('p|L128', level(128), 0, NEEDS_NOTHING);
      residency.upload('q|L128', level(128), 0, NEEDS_NOTHING);

      const refused = residency.upload('p|L128', level(1024), 1, NEEDS_NOTHING);

      expect(refused).toBe('over-budget');
      expect(evicted).toEqual([]);
      expect(residency.keys()).toEqual(['p|L128', 'q|L128']);
    });
  });

  describe('the ledger during a replacement of an own texture', () => {
    it('reports the old and the new texture together before the old one is freed', () => {
      const totals: number[] = [];
      const ledger = new MemoryLedger();
      const set = ledger.set.bind(ledger);
      ledger.set = (category: MemoryCategory, owner: string, bytes: number): void => {
        set(category, owner, bytes);
        totals.push(ledger.bytesOf('textures'));
      };
      const residency = new TextureResidency(
        new FakeGpuBackend(),
        ledger,
        64 * MIB,
        () => undefined,
      );
      residency.upload('a|L512', level(512), 0, NEEDS_NOTHING);
      totals.length = 0;

      residency.upload('a|L512', level(512), 1, NEEDS_NOTHING);

      expect(Math.max(...totals)).toBe(2 * MIB);
      expect(totals.at(-1)).toBe(MIB);
    });
  });
});

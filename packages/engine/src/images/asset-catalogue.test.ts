import { describe, expect, it } from 'vitest';

import { assetRecordSchema, type AssetId } from '@canvas/schema';

import { flushMicrotasks } from './__fixtures__/manual-job-runner.js';
import { AssetCatalogue, isServerLevel, showableLevels } from './asset-catalogue.js';
import type { AssetSource, ImageAssetInfo, ImageAssetListener } from './asset-source.js';
import { RETRY_DELAYS_MS, RetrySchedule } from './retry-schedule.js';

const PHOTO = 'photo' as AssetId;

/**
 * A source whose one asset is described as a test says, and re-described on demand.
 *
 * @param first - The first description.
 * @returns The source, and a way to send a new description to its subscribers.
 */
function sourceOf(first: ImageAssetInfo): {
  source: AssetSource;
  update: (info: ImageAssetInfo) => void;
} {
  const listeners: ImageAssetListener[] = [];
  const never = (): Promise<never> => Promise.reject(new Error('not in this test'));
  return {
    source: {
      describe: () => Promise.resolve(first),
      fetchLevel: never,
      fetchTile: never,
      fetchOriginal: never,
      subscribe: (assetId, listener) => {
        listeners.push(listener);
        return () => undefined;
      },
    },
    update: (info) => {
      for (const listener of listeners) listener(info);
    },
  };
}

const PENDING: ImageAssetInfo = {
  mimeType: 'image/png',
  naturalSize: null,
  levels: [],
  tiles: null,
  averageColor: null,
  blurhash: null,
};

describe('AssetCatalogue', () => {
  it("takes the assets service's record as it is, AVIF levels with their WebP fallbacks", async () => {
    const level = (longEdgePx: number, format: 'avif' | 'webp') => ({ longEdgePx, format });
    const record = assetRecordSchema.parse({
      id: 'a'.repeat(64),
      mimeType: 'image/jpeg',
      byteLength: 1_200_000,
      naturalSize: { width: 3000, height: 2000 },
      status: 'processing',
      levels: [level(128, 'avif'), level(128, 'webp'), level(512, 'avif'), level(512, 'webp')],
      tiles: null,
      blurhash: null,
      averageColor: [0.5, 0.4, 0.3, 1],
      progress: 0.5,
      createdAt: 0,
    });
    const { source } = sourceOf(record);
    const catalogue = new AssetCatalogue(source, 8192);

    const entry = catalogue.entry(PHOTO);
    await flushMicrotasks();

    expect(entry.status).toBe('described');
    expect(entry.levels).toEqual([128, 512, 2048, 3000]);
    expect([128, 512, 2048].map((edge) => isServerLevel(record, edge))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('keeps an asset whose size is not known yet undescribed, then describes it', async () => {
    const { source, update } = sourceOf(PENDING);
    const catalogue = new AssetCatalogue(source, 8192);
    const changes: string[] = [];
    catalogue.listen((assetId) => changes.push(assetId));

    const entry = catalogue.entry(PHOTO);
    await flushMicrotasks();

    expect(entry).toMatchObject({ status: 'describing', levels: [], view: undefined });
    update({ ...PENDING, naturalSize: { width: 1000, height: 800 }, averageColor: [1, 0, 0, 1] });
    expect(entry.status).toBe('described');
    expect(entry.levels).toEqual([128, 512, 1000]);
    expect(changes).toEqual([PHOTO, PHOTO]);
  });

  it('keeps CPU copies of smallest levels under its cap, dropping the least recently used', async () => {
    const described: ImageAssetInfo = {
      ...PENDING,
      naturalSize: { width: 1000, height: 800 },
      averageColor: [0, 0, 0, 1],
    };
    const catalogue = new AssetCatalogue(sourceOf(described).source, 8192, 250);
    const ids = ['a', 'b', 'c'].map((name) => name as AssetId);
    for (const id of ids) catalogue.entry(id);
    await flushMicrotasks();
    const level = { widthPx: 10, heightPx: 10, rgba: new Uint8Array(100) };
    const smallest = (assetId: AssetId) => ({ kind: 'server' as const, assetId, longEdgePx: 128 });

    catalogue.keepSmallest(smallest(ids[0] ?? PHOTO), level);
    catalogue.keepSmallest(smallest(ids[1] ?? PHOTO), level);
    // Reading a's copy makes b the least recently used.
    catalogue.smallestOf(smallest(ids[0] ?? PHOTO));
    catalogue.keepSmallest(smallest(ids[2] ?? PHOTO), level);

    expect(ids.map((id) => catalogue.smallestOf(smallest(id)) !== undefined)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('knows its described GIFs through description, sweep, restore and refusal', async () => {
    const gif: ImageAssetInfo = {
      ...PENDING,
      mimeType: 'image/GIF',
      naturalSize: { width: 1000, height: 800 },
    };
    let isRefused = false;
    const source: AssetSource = {
      ...sourceOf(gif).source,
      describe: () => (isRefused ? Promise.reject(new Error('404')) : Promise.resolve(gif)),
    };
    const due: (() => void)[] = [];
    const schedule = new RetrySchedule<AssetId>((callback) => {
      due.push(callback);
      return undefined;
    });
    const catalogue = new AssetCatalogue(source, 8192, undefined, schedule);
    const revisions = new Set([catalogue.gifRevision]);
    const smallest = { kind: 'server' as const, assetId: PHOTO, longEdgePx: 128 };

    catalogue.use(PHOTO);
    expect(catalogue.isDescribedGif(PHOTO)).toBe(false);
    await flushMicrotasks();
    expect(catalogue.isDescribedGif(PHOTO)).toBe(true);
    revisions.add(catalogue.gifRevision);
    catalogue.keepSmallest(smallest, { widthPx: 10, heightPx: 8, rgba: new Uint8Array(320) });

    // Swept, its copy kept: no longer listed, even when a new texture limit re-reads the copy.
    catalogue.release(PHOTO);
    catalogue.sweep();
    expect(catalogue.isDescribedGif(PHOTO)).toBe(false);
    catalogue.setMaxTextureSize(4096);
    expect(catalogue.isDescribedGif(PHOTO)).toBe(false);
    revisions.add(catalogue.gifRevision);

    // Used again: restored from its copy, described at once; then the source isRefused it.
    isRefused = true;
    catalogue.use(PHOTO);
    expect(catalogue.isDescribedGif(PHOTO)).toBe(true);
    revisions.add(catalogue.gifRevision);
    await flushMicrotasks();
    expect(catalogue.peek(PHOTO)?.status).toBe('describing');
    expect(catalogue.isDescribedGif(PHOTO)).toBe(false);
    revisions.add(catalogue.gifRevision);
    // Each change of the list moved the revision.
    expect(revisions.size).toBe(5);

    catalogue.destroy();
    expect(catalogue.isDescribedGif(PHOTO)).toBe(false);
  });

  it('retries a description the source isRefused, with backoff, then marks it failed', async () => {
    let describes = 0;
    const source: AssetSource = {
      ...sourceOf(PENDING).source,
      describe: () => {
        describes += 1;
        return Promise.reject(new Error('404'));
      },
    };
    const waits: number[] = [];
    const due: (() => void)[] = [];
    const timer = (callback: () => void, delayMs: number): undefined => {
      waits.push(delayMs);
      due.push(callback);
      return undefined;
    };
    const catalogue = new AssetCatalogue(source, 8192, undefined, new RetrySchedule(timer));

    const entry = catalogue.entry(PHOTO);
    await flushMicrotasks();
    expect(entry.status).toBe('describing');
    while (due.length > 0) {
      for (const callback of due.splice(0)) callback();
      await flushMicrotasks();
    }

    expect(entry.status).toBe('failed');
    expect(describes).toBe(RETRY_DELAYS_MS.length + 1);
    expect(waits).toEqual([...RETRY_DELAYS_MS]);
  });

  it('describes an asset once a retry finds it (linked to the board after its upload)', async () => {
    let isLinked = false;
    const described: ImageAssetInfo = { ...PENDING, naturalSize: { width: 800, height: 600 } };
    const source: AssetSource = {
      ...sourceOf(PENDING).source,
      describe: () => (isLinked ? Promise.resolve(described) : Promise.reject(new Error('404'))),
    };
    const due: (() => void)[] = [];
    const schedule = new RetrySchedule<AssetId>((callback) => {
      due.push(callback);
      return undefined;
    });
    const catalogue = new AssetCatalogue(source, 8192, undefined, schedule);

    const entry = catalogue.entry(PHOTO);
    await flushMicrotasks();
    isLinked = true;
    for (const callback of due.splice(0)) callback();
    await flushMicrotasks();

    expect(entry.status).toBe('described');
    expect(schedule.mayTry(PHOTO)).toBe(true);
  });
});

describe('showableLevels', () => {
  const info = (isTiled: boolean): ImageAssetInfo => ({
    ...PENDING,
    tiles: isTiled ? { tileSizePx: 256, levels: 1, format: 'webp' } : null,
  });

  it('offers the pyramid levels below the original, and the original itself', () => {
    expect(showableLevels({ width: 3000, height: 2000 }, info(false), 8192)).toEqual([
      128, 512, 2048, 3000,
    ]);
  });

  it('offers a tiled image only the levels the server made: its original is never decoded', () => {
    const made = (edges: readonly number[]): ImageAssetInfo => ({
      ...info(true),
      levels: edges.map((longEdgePx) => ({ longEdgePx, format: 'webp' })),
    });
    expect(showableLevels({ width: 8000, height: 6000 }, made([128, 512]), 8192)).toEqual([
      128, 512,
    ]);
    expect(showableLevels({ width: 8000, height: 6000 }, made([4096, 128]), 2048)).toEqual([128]);
    expect(showableLevels({ width: 8000, height: 6000 }, info(true), 8192)).toEqual([]);
  });

  it('shows the original as the top level only up to the texture limit and 4096 px', () => {
    expect(showableLevels({ width: 4096, height: 3000 }, info(false), 8192)).toEqual([
      128, 512, 2048, 4096,
    ]);
    expect(showableLevels({ width: 5000, height: 3000 }, info(false), 8192)).toEqual([
      128, 512, 2048, 4096,
    ]);
    expect(showableLevels({ width: 3000, height: 2000 }, info(false), 2048)).toEqual([
      128, 512, 2048,
    ]);
  });

  it('keeps every level within the GPU texture limit', () => {
    expect(showableLevels({ width: 3000, height: 2000 }, info(false), 2048)).toEqual([
      128, 512, 2048,
    ]);
    expect(showableLevels({ width: 100, height: 50 }, info(false), 8192)).toEqual([100]);
  });
});

describe('AssetCatalogue after destroy', () => {
  it('ignores descriptions and failures that arrive after it was destroyed', async () => {
    const changes: string[] = [];
    const described = new AssetCatalogue(sourceOf(PENDING).source, 8192);
    const failing = new AssetCatalogue(
      { ...sourceOf(PENDING).source, describe: () => Promise.reject(new Error('404')) },
      8192,
    );
    for (const catalogue of [described, failing]) {
      catalogue.listen((assetId) => changes.push(assetId));
      catalogue.entry(PHOTO);
      catalogue.destroy();
    }

    await flushMicrotasks();

    expect(changes).toEqual([]);
  });

  it('frees every CPU copy and stops every retry wait when destroyed', async () => {
    const described: ImageAssetInfo = { ...PENDING, naturalSize: { width: 1000, height: 800 } };
    const pending: (() => void)[] = [];
    const schedule = new RetrySchedule<AssetId>((callback) => {
      pending.push(callback);
      return () => {
        pending.splice(pending.indexOf(callback), 1);
      };
    });
    const unknown = 'unknown' as AssetId;
    const source: AssetSource = {
      ...sourceOf(described).source,
      describe: (assetId) =>
        assetId === unknown ? Promise.reject(new Error('404')) : Promise.resolve(described),
    };
    const catalogue = new AssetCatalogue(source, 8192, undefined, schedule);
    const entry = catalogue.entry(PHOTO);
    catalogue.entry(unknown);
    await flushMicrotasks();
    const level = { widthPx: 128, heightPx: 102, rgba: new Uint8Array(128 * 102 * 4) };
    catalogue.keepSmallest({ kind: 'server', assetId: PHOTO, longEdgePx: 128 }, level);
    expect(pending).toHaveLength(1);

    catalogue.destroy();

    expect(entry.smallest).toBeUndefined();
    expect(pending).toEqual([]);
  });
});

describe('AssetCatalogue references', () => {
  const described: ImageAssetInfo = {
    ...PENDING,
    naturalSize: { width: 1000, height: 800 },
  };

  it('keeps an asset while any object uses it, and drops it at the sweep after the last', async () => {
    const { source } = sourceOf(described);
    const catalogue = new AssetCatalogue(source, 8192);
    catalogue.use(PHOTO);
    catalogue.use(PHOTO);
    await flushMicrotasks();

    catalogue.release(PHOTO);
    catalogue.sweep();
    expect(catalogue.peek(PHOTO)?.status).toBe('described');
    catalogue.release(PHOTO);
    catalogue.use(PHOTO);
    catalogue.sweep();
    expect(catalogue.peek(PHOTO)).toBeDefined();
    catalogue.release(PHOTO);
    catalogue.sweep();

    expect(catalogue.peek(PHOTO)).toBeUndefined();
  });

  it('works out the levels again for a new texture limit, dropping a copy that no longer fits', async () => {
    const { source } = sourceOf(described);
    const pending = sourceOf(PENDING);
    const catalogue = new AssetCatalogue(source, 8192);
    const other = new AssetCatalogue(pending.source, 8192);
    const entry = catalogue.entry(PHOTO);
    const waiting = other.entry(PHOTO);
    await flushMicrotasks();
    const level = { widthPx: 128, heightPx: 102, rgba: new Uint8Array(128 * 102 * 4) };
    catalogue.keepSmallest({ kind: 'server', assetId: PHOTO, longEdgePx: 128 }, level);

    catalogue.setMaxTextureSize(512);
    expect(entry.levels).toEqual([128, 512]);
    expect(entry.smallest).toBe(level);
    catalogue.setMaxTextureSize(100);
    other.setMaxTextureSize(100);

    expect(entry.levels).toEqual([]);
    expect(entry.smallest).toBeUndefined();
    expect(entry.hasBeenReady).toBe(true);
    expect(waiting.status).toBe('describing');
  });
});

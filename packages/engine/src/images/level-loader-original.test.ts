import { describe, expect, it } from 'vitest';

import { ASSETS, createLoader, heldSource, PHOTO } from './__fixtures__/level-loader-harness.js';
import { flushMicrotasks } from './__fixtures__/manual-job-runner.js';
import type { AssetSource } from './asset-source.js';
import { createFixtureAssetSource } from './fixture-asset-source.js';

describe('the original of an asset, asked for again while a client batch is partly cancelled', () => {
  const client = (longEdgePx: number) =>
    ({ kind: 'client', assetId: PHOTO, longEdgePx, mimeType: 'image/png' }) as const;
  const originalFetches = (held: ReturnType<typeof heldSource>) =>
    held.held.filter(({ fetch }) => fetch.kind === 'original').length;

  /**
   * A loader with a batch of three client levels of one asset, fetching its original.
   *
   * @returns The loader, its held source and what it recorded.
   */
  async function fetchingBatch() {
    const held = heldSource();
    const created = createLoader(6, held.source);
    for (const edge of [128, 512, 2048]) {
      created.loader.request(`photo ${String(edge)}`, client(edge), 'visible');
    }
    created.loader.pump();
    await flushMicrotasks();
    return { held, ...created };
  }

  it('fetches the original once, and decodes the level asked for again with the batch', async () => {
    const { held, loader, jobs, loaded } = await fetchingBatch();
    expect(originalFetches(held)).toBe(1);

    loader.cancel('photo 512');
    loader.cancel('photo 2048');
    loader.request('photo 512', client(512), 'visible');
    loader.pump();
    await flushMicrotasks();

    expect(originalFetches(held)).toBe(1);
    expect(held.aborted).toEqual([]);
    expect(loader.runningCount).toBe(1);

    held.held[0]?.release();
    await jobs.settle();

    expect(jobs.submitted.map(({ longEdgesPx }) => longEdgesPx)).toEqual([[128, 512]]);
    expect(loaded).toEqual(['photo 128', 'photo 512']);
    expect(loader.pendingCount).toBe(0);
  });

  it('keeps the fetch while a level joined to it is the only one wanted', async () => {
    const { held, loader, jobs, loaded } = await fetchingBatch();
    loader.cancel('photo 128');
    loader.cancel('photo 512');
    loader.request('photo 4096', client(4096), 'near');
    loader.pump();
    await flushMicrotasks();

    loader.cancel('photo 2048');
    loader.pump();
    await flushMicrotasks();
    held.held[0]?.release();
    await jobs.settle();

    expect(originalFetches(held)).toBe(1);
    expect(held.aborted).toEqual([]);
    expect(loaded).toEqual(['photo 4096']);
  });

  it('keeps the fetch when the last levels are cancelled and others of the asset asked for in one frame', async () => {
    // Zooming in: 512 becomes unwanted and 2048 wanted, cancels first, then requests.
    const { held, loader, jobs, loaded } = await fetchingBatch();

    for (const edge of [128, 512, 2048]) loader.cancel(`photo ${String(edge)}`);
    loader.request('photo 512', client(512), 'visible');
    loader.request('photo 2048', client(2048), 'visible');
    loader.pump();
    await flushMicrotasks();

    expect(originalFetches(held)).toBe(1);
    expect(held.aborted).toEqual([]);
    expect(loader.runningCount).toBe(1);

    held.held[0]?.release();
    await jobs.settle();

    expect(jobs.submitted.map(({ longEdgesPx }) => longEdgesPx)).toEqual([[512, 2048]]);
    expect(loaded).toEqual(['photo 512', 'photo 2048']);
  });

  it('aborts a fetch left with no level at the next pump, and frees its slot then', async () => {
    const { held, loader } = await fetchingBatch();

    for (const edge of [128, 512, 2048]) loader.cancel(`photo ${String(edge)}`);
    expect(held.aborted).toEqual([]);
    loader.pump();
    await flushMicrotasks();

    expect(held.aborted).toEqual(['photo original']);
    expect(loader.runningCount).toBe(0);
    expect(held.inFlight()).toBe(0);

    loader.request('photo 512', client(512), 'visible');
    loader.pump();
    await flushMicrotasks();

    expect(originalFetches(held)).toBe(2);
    expect(held.inFlight()).toBe(1);
    expect(loader.runningCount).toBe(1);
  });

  it('aborts a fetch left with no level at once when the loader is destroyed', async () => {
    const { held, loader } = await fetchingBatch();

    loader.destroy();

    expect(held.aborted).toEqual(['photo original']);
    expect(loader.runningCount).toBe(0);
  });

  it('fails a level that joined a fetch when the fetch rejects, and rejects nothing unhandled', async () => {
    let rejectFetch: (error: Error) => void = () => undefined;
    let fetches = 0;
    const fixture = createFixtureAssetSource(1, { assets: ASSETS });
    const failing: AssetSource = {
      ...fixture,
      fetchOriginal: () =>
        new Promise<ArrayBuffer>((resolve, reject) => {
          fetches += 1;
          rejectFetch = reject;
        }),
    };
    const { loader, waits, loaded } = createLoader(6, failing);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      loader.request('photo 128', client(128), 'visible');
      loader.request('photo 512', client(512), 'visible');
      loader.pump();
      await flushMicrotasks();
      loader.cancel('photo 128');
      loader.cancel('photo 512');
      loader.request('photo 512', client(512), 'visible');
      loader.pump();
      await flushMicrotasks();

      rejectFetch(new Error('network down'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(loaded).toEqual([]);
    expect(loader.pendingCount).toBe(0);
    expect(loader.runningCount).toBe(0);
    expect(fetches).toBe(1);
    expect(waits).toHaveLength(1);
    expect(unhandled).toEqual([]);
  });

  it('keeps only the levels still wanted in a fetch, however often they are cancelled and asked for', async () => {
    const { loader } = await fetchingBatch();

    for (let turn = 0; turn < 50; turn += 1) {
      loader.cancel('photo 512');
      loader.request('photo 512', client(512), 'visible');
    }

    const { fetching } = loader as unknown as { fetching: Map<string, { loads: unknown[] }> };
    expect(fetching.get(PHOTO)?.loads).toHaveLength(3);
  });

  it('starts a new fetch for a level asked for once the original reached its decode', async () => {
    const { held, loader, jobs } = await fetchingBatch();
    held.held[0]?.release();
    await flushMicrotasks();

    loader.request('photo 4096', client(4096), 'visible');
    loader.pump();
    await flushMicrotasks();
    await jobs.settle();

    expect(originalFetches(held)).toBe(2);
  });
});

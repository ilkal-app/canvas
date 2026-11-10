import { describe, expect, it } from 'vitest';

import { WorkerPool } from '../workers/worker-pool.js';

import {
  ASSETS,
  createLoader,
  heldSource,
  OTHER,
  PHOTO,
} from './__fixtures__/level-loader-harness.js';
import { flushMicrotasks } from './__fixtures__/manual-job-runner.js';
import type { AssetSource } from './asset-source.js';
import { createFixtureAssetSource } from './fixture-asset-source.js';
import { ImageLoadDeferredError } from './image-load-deferred.js';
import { RETRY_DELAYS_MS } from './retry-schedule.js';

const server = (longEdgePx: number, assetId = PHOTO) =>
  ({ kind: 'server', assetId, longEdgePx }) as const;

describe('LevelLoader', () => {
  it('fetches a server level and decodes it in a job at its own size', async () => {
    const { loader, jobs, loaded, levels } = createLoader();

    loader.request('photo 512', { kind: 'server', assetId: PHOTO, longEdgePx: 512 }, 'visible');
    loader.pump();
    await jobs.settle();

    expect(loaded).toEqual(['photo 512']);
    expect(levels.get('photo 512')).toMatchObject({ widthPx: 512, heightPx: 341 });
    expect(jobs.submitted).toEqual([
      { id: 1, assetId: PHOTO, longEdgesPx: [512], priority: 'visible' },
    ]);
    expect(loader.pendingCount).toBe(0);
  });

  it('starts the most urgent loads first and no more than its cap', async () => {
    const { loader, jobs } = createLoader(2);
    loader.request('a', { kind: 'server', assetId: PHOTO, longEdgePx: 128 }, 'prefetch');
    loader.request('b', { kind: 'server', assetId: PHOTO, longEdgePx: 512 }, 'near');
    loader.request('c', { kind: 'server', assetId: OTHER, longEdgePx: 128 }, 'visible');

    loader.pump();
    await flushMicrotasks();

    expect(
      jobs.submitted.map(({ longEdgesPx, priority }) => `${priority} ${String(longEdgesPx)}`),
    ).toEqual(['visible 128', 'near 512']);
  });

  it('resizes the original once for every client level of an asset waiting together', async () => {
    const { loader, jobs, loaded, levels } = createLoader();
    loader.request(
      'photo 128',
      { kind: 'client', assetId: PHOTO, longEdgePx: 128, mimeType: 'image/png' },
      'visible',
    );
    loader.request(
      'photo 2048',
      { kind: 'client', assetId: PHOTO, longEdgePx: 2048, mimeType: 'image/png' },
      'visible',
    );

    loader.pump();
    await jobs.settle();

    expect(jobs.submitted.map(({ longEdgesPx }) => longEdgesPx)).toEqual([[128, 2048]]);
    expect(loaded).toEqual(['photo 128', 'photo 2048']);
    expect(levels.get('photo 2048')).toMatchObject({ widthPx: 2048, heightPx: 1365 });
  });

  it('passes a changed priority on to a job still waiting in the pool', async () => {
    const { loader, jobs } = createLoader();
    loader.request('photo 512', { kind: 'server', assetId: PHOTO, longEdgePx: 512 }, 'prefetch');
    loader.pump();
    await flushMicrotasks();

    loader.request('photo 512', { kind: 'server', assetId: PHOTO, longEdgePx: 512 }, 'visible');

    expect(jobs.priorityChanges).toEqual(['1:visible']);
  });

  it('forgets a queued load that is cancelled', async () => {
    const { loader, jobs, loaded } = createLoader();
    loader.request('photo 512', { kind: 'server', assetId: PHOTO, longEdgePx: 512 }, 'prefetch');

    loader.cancel('photo 512');
    loader.pump();
    await jobs.settle();

    expect(jobs.submitted).toEqual([]);
    expect(loaded).toEqual([]);
  });

  it('cancels the job of a running load and reports nothing', async () => {
    const { loader, jobs, loaded, waits } = createLoader();
    loader.request('photo 512', { kind: 'server', assetId: PHOTO, longEdgePx: 512 }, 'prefetch');
    loader.pump();
    await flushMicrotasks();

    loader.cancel('photo 512');
    await jobs.settle();

    expect(jobs.cancelled).toEqual([1]);
    expect(loaded).toEqual([]);
    expect(waits).toEqual([]);
  });

  it('keeps a shared client job running while one of its levels is still wanted', async () => {
    const { loader, jobs, loaded } = createLoader();
    loader.request(
      'photo 128',
      { kind: 'client', assetId: PHOTO, longEdgePx: 128, mimeType: 'image/png' },
      'visible',
    );
    loader.request(
      'photo 2048',
      { kind: 'client', assetId: PHOTO, longEdgePx: 2048, mimeType: 'image/png' },
      'visible',
    );
    loader.pump();
    await flushMicrotasks();

    loader.cancel('photo 2048');
    await jobs.settle();

    expect(jobs.cancelled).toEqual([]);
    expect(loaded).toEqual(['photo 128']);
  });

  it('asks again for a level that cannot be fetched only when its retry is due, then gives up', async () => {
    const { loader, jobs, waits, retriesDue } = createLoader();
    const request = (): void => {
      loader.request('photo 4096', { kind: 'server', assetId: PHOTO, longEdgePx: 4096 }, 'visible');
      loader.pump();
    };

    request();
    await jobs.settle();
    // Every frame asks while the level is wanted; none of them fetches while it waits.
    request();

    expect(loader.has('photo 4096')).toBe(false);
    let retries = 0;
    while (waits.length > 0) {
      retries += 1;
      waits.shift()?.();
      request();
      expect(loader.has('photo 4096')).toBe(true);
      await jobs.settle();
    }
    request();

    expect(retries).toBe(RETRY_DELAYS_MS.length);
    expect(retriesDue).toHaveLength(RETRY_DELAYS_MS.length);
    expect(waits).toEqual([]);
    expect(loader.has('photo 4096')).toBe(false);
    loader.forgetFailures((key) => key.startsWith('photo'));
    request();
    expect(loader.has('photo 4096')).toBe(true);
  });

  it('ignores a cancel of a level it never asked for, and a batch cancelled while fetching', async () => {
    const { loader, jobs, loaded } = createLoader();
    loader.cancel('never asked');
    loader.request('photo 512', { kind: 'server', assetId: PHOTO, longEdgePx: 512 }, 'visible');
    loader.pump();

    loader.cancel('photo 512');
    await jobs.settle();

    expect(jobs.submitted).toEqual([]);
    expect(loaded).toEqual([]);
  });

  it('aborts a cancelled fetch and gives its slot to the next load at once', async () => {
    const held = heldSource();
    const { loader, waits, retriesDue } = createLoader(1, held.source);
    loader.request('photo 512', server(512), 'near');
    loader.pump();
    await flushMicrotasks();

    loader.cancel('photo 512');
    loader.request('other 128', server(128, OTHER), 'visible');
    loader.pump();
    await flushMicrotasks();

    expect(held.aborted).toEqual(['photo 512']);
    expect(loader.runningCount).toBe(1);
    expect(held.held.map(({ fetch }) => `${fetch.assetId} ${String(fetch.longEdgePx)}`)).toEqual([
      'photo 512',
      'other 128',
    ]);
    // The aborted fetch is gone; only the new one is in flight.
    expect(held.inFlight()).toBe(1);
    // Its rejection is no failure: no retry waits for it.
    expect(waits).toEqual([]);
    expect(retriesDue).toEqual([]);
  });

  it('joins a load still fetching, and replaces a cancelled one with one new fetch', async () => {
    const held = heldSource();
    const { loader, waits } = createLoader(6, held.source);
    loader.request('photo 512', server(512), 'near');
    loader.pump();
    await flushMicrotasks();
    loader.request('photo 512', server(512), 'visible');
    loader.pump();
    await flushMicrotasks();
    expect(held.inFlight()).toBe(1);

    loader.cancel('photo 512');
    loader.request('photo 512', server(512), 'visible');
    loader.pump();
    await flushMicrotasks();

    expect(held.aborted).toEqual(['photo 512']);
    expect(held.inFlight()).toBe(1);
    expect(loader.runningCount).toBe(1);
    expect(waits).toEqual([]);
  });

  it('fails the levels a decode did not return, so the loader becomes idle', async () => {
    const pool = new WorkerPool({
      workerCount: 0,
      fallbackHandlers: {
        decode: (request) =>
          Promise.resolve({
            response: {
              assetId: request.assetId,
              levels: [{ widthPx: 1, heightPx: 1, rgba: new Uint8Array(4) }],
            },
            transfer: [],
          }),
      },
    });
    const { loader, loaded, waits } = createLoader(6, undefined, pool);
    loader.request('photo 128', { ...server(128), kind: 'client', mimeType: '' }, 'visible');
    loader.request('photo 512', { ...server(512), kind: 'client', mimeType: '' }, 'visible');
    loader.pump();
    for (let round = 0; round < 5; round += 1) {
      await flushMicrotasks();
      pool.drainMainThread(Number.POSITIVE_INFINITY, () => 0);
    }
    await flushMicrotasks();

    expect(loaded).toEqual(['photo 128']);
    expect(loader.pendingCount).toBe(0);
    expect(waits).toHaveLength(1);
  });

  it('reports a decode that nothing can run, and keeps the level for its retry', async () => {
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: {} });
    const { loader, decoderMissing, waits } = createLoader(6, undefined, pool);
    loader.request('photo 128', server(128), 'visible');
    loader.pump();
    for (let round = 0; round < 5; round += 1) {
      await flushMicrotasks();
      pool.drainMainThread(Number.POSITIVE_INFINITY, () => 0);
    }
    await flushMicrotasks();

    expect(decoderMissing).toHaveLength(1);
    expect(decoderMissing[0]?.message).toContain('No handler');
    expect(loader.pendingCount).toBe(0);
    expect(waits).toHaveLength(1);
  });

  it("passes the original's media type to the decode of client levels", async () => {
    const requests: string[] = [];
    const pool = new WorkerPool({
      workerCount: 0,
      fallbackHandlers: {
        decode: (request) => {
          requests.push(request.mimeType);
          return Promise.resolve({
            response: { assetId: request.assetId, levels: [] },
            transfer: [],
          });
        },
      },
    });
    const { loader } = createLoader(6, undefined, pool);
    loader.request('photo 128', { ...server(128), kind: 'client', mimeType: 'image/jpeg' }, 'near');
    loader.request('other 128', server(128, OTHER), 'visible');
    loader.pump();
    for (let round = 0; round < 5; round += 1) {
      await flushMicrotasks();
      pool.drainMainThread(Number.POSITIVE_INFINITY, () => 0);
    }

    expect(requests).toEqual(['', 'image/jpeg']);
  });

  it('decodes nothing for a load cancelled while a source that ignores the signal fetched it', async () => {
    const fixture = createFixtureAssetSource(1, { assets: ASSETS });
    let release: () => void = () => undefined;
    const ignoring: AssetSource = {
      ...fixture,
      fetchLevel: async (assetId, longEdgePx) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return fixture.fetchLevel(assetId, longEdgePx);
      },
    };
    const { loader, jobs, loaded } = createLoader(6, ignoring);
    loader.request('photo 512', server(512), 'visible');
    loader.pump();
    await flushMicrotasks();

    loader.cancel('photo 512');
    release();
    await jobs.settle();

    expect(jobs.submitted).toEqual([]);
    expect(loaded).toEqual([]);
    expect(loader.runningCount).toBe(0);
  });
});

it('releases load slots through repeated capacity waits without exhausting failure retries', async () => {
  const fixture = createFixtureAssetSource(1, { assets: ASSETS });
  let calls = 0;
  const source: AssetSource = {
    ...fixture,
    fetchLevel(assetId, edge, signal) {
      calls += 1;
      return calls <= 8
        ? Promise.reject(new ImageLoadDeferredError(10_000))
        : fixture.fetchLevel(assetId, edge, signal);
    },
  };
  const { loader, jobs, waits, loaded } = createLoader(1, source);
  for (let index = 0; index < 8; index += 1) {
    loader.request('photo 512', server(512), 'visible');
    loader.pump();
    await flushMicrotasks();
    expect(loader.runningCount).toBe(0);
    expect(jobs.submitted).toHaveLength(0);
    waits.shift()?.();
  }
  loader.request('photo 512', server(512), 'visible');
  loader.pump();
  await jobs.settle();
  expect(calls).toBe(9);
  expect(loaded).toEqual(['photo 512']);
});

import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import type { JobId } from '../workers/job-id.js';
import type { FramesJobResponse } from '../workers/job-kinds.js';

import { AnimationLoads } from './animation-loads.js';
import type { AssetSource } from './asset-source.js';
import type { ImageJobRunner } from './level-loader.js';

const GIF = 'gif' as AssetId;
const FRAMES: FramesJobResponse = { assetId: GIF, widthPx: 1, heightPx: 1, frames: [], plays: 1 };

/**
 * A promise and its settlers.
 *
 * @returns The promise, and what resolves and rejects it.
 */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

/**
 * Loads over a source whose original fetches and a runner whose jobs the test settles; the
 * runner's cancel does nothing, as a job already running in a worker finishes anyway.
 *
 * @returns The loads and their fakes.
 */
function setUp() {
  const fetches: ReturnType<typeof deferred<ArrayBuffer>>[] = [];
  const jobs: ReturnType<typeof deferred<FramesJobResponse>>[] = [];
  const events: string[] = [];
  const cancelled: JobId[] = [];
  const assets = {
    fetchOriginal: () => {
      const fetch = deferred<ArrayBuffer>();
      fetches.push(fetch);
      return fetch.promise;
    },
  } as unknown as AssetSource;
  const runner = {
    submit: () => {
      const job = deferred<FramesJobResponse>();
      jobs.push(job);
      return { id: jobs.length, response: job.promise };
    },
    cancel: (id: JobId) => {
      cancelled.push(id);
      return false;
    },
    setPriority: () => false,
  } as unknown as ImageJobRunner;
  const loads = new AnimationLoads(assets, runner, {
    onLoaded: (assetId) => events.push(`loaded ${assetId}`),
    onFailed: (assetId) => events.push(`failed ${assetId}`),
    onQueued: () => events.push('queued'),
  });
  return { loads, fetches, jobs, events, cancelled };
}

describe('AnimationLoads', () => {
  it('fetches the original once, decodes it in a frames job and delivers the frames', async () => {
    const { loads, fetches, jobs, events } = setUp();
    loads.start(GIF, 1024);
    loads.start(GIF, 1024);
    expect(fetches).toHaveLength(1);
    expect(loads.isLoading).toBe(true);
    fetches[0]?.resolve(new ArrayBuffer(4));
    await flush();
    jobs[0]?.resolve(FRAMES);
    await flush();
    expect(events).toEqual(['queued', 'loaded gif']);
    expect(loads.isLoading).toBe(false);
  });

  it('reports a failed fetch, and nothing for a load cancelled before it failed', async () => {
    const { loads, fetches, events } = setUp();
    loads.start(GIF, 1024);
    fetches[0]?.reject(new Error('offline'));
    await flush();
    loads.start(GIF, 1024);
    loads.cancel(GIF);
    fetches[1]?.reject(new Error('aborted'));
    await flush();
    expect(events).toEqual(['failed gif']);
  });

  it('submits no job for a fetch that lands after its load was cancelled', async () => {
    const { loads, fetches, jobs, events } = setUp();
    loads.start(GIF, 1024);
    loads.cancel(GIF);
    loads.cancel(GIF);
    fetches[0]?.resolve(new ArrayBuffer(4));
    await flush();
    expect(jobs).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it('cancels a running job and delivers nothing it answers after', async () => {
    const { loads, fetches, jobs, events, cancelled } = setUp();
    loads.start(GIF, 1024);
    fetches[0]?.resolve(new ArrayBuffer(4));
    await flush();
    loads.destroy();
    expect(cancelled).toEqual([1]);
    jobs[0]?.resolve(FRAMES);
    await flush();
    expect(events).toEqual(['queued']);
  });
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { AssetId } from '@canvas/schema';

import { newFakeRecord } from './__fixtures__/fake-asset-records.js';
import { AssetFollower } from './asset-follower.js';
import { AssetsHttp } from './assets-http.js';

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

it.each([false, true])(
  'pauses 300 queued polls on Retry-After (news/revive: %s)',
  async (hasNews) => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response('{}', { status: 429, headers: { 'retry-after': '60' } })),
    );
    const http = new AssetsHttp(
      { assetsUrl: 'https://assets.example', boardId: 'board', token: 'token' },
      fetch,
    );
    const record = vi.spyOn(http, 'record');
    const follower = new AssetFollower({
      http: () => http,
      onRecord: () => undefined,
      maxStreams: 0,
    });
    const ids = Array.from(
      { length: 300 },
      (unused, i) => i.toString(16).padStart(64, '0') as AssetId,
    );
    for (const id of ids) follower.follow(id, undefined);
    follower.setVisible(new Set(ids));
    await vi.advanceTimersByTimeAsync(0);
    expect(record).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(http.readWaitMs).toBe(60_000);

    await vi.advanceTimersByTimeAsync(10_000);
    if (hasNews) {
      const first = ids[0];
      const last = ids[299];
      if (first === undefined || last === undefined) throw new Error('Missing fixture IDs');
      follower.learn(newFakeRecord(last, new Uint8Array([1]), 'ready'));
      follower.revive(first);
    }
    await vi.advanceTimersByTimeAsync(49_999);
    expect(record).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(http.readWaitMs).toBe(1);

    fetch.mockImplementation(() => Promise.resolve(new Response('{}', { status: 404 })));
    await vi.advanceTimersByTimeAsync(1);
    expect(record).toHaveBeenCalledTimes(8);
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(http.readWaitMs).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(record).toHaveBeenCalledTimes(12);
    expect(fetch).toHaveBeenCalledTimes(12);
    follower.close();
    expect(vi.getTimerCount()).toBe(0);
  },
);

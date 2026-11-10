import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { AssetId } from '@canvas/schema';

import { newFakeRecord } from './__fixtures__/fake-asset-records.js';
import { AssetFollower, type FollowerHttp } from './asset-follower.js';
import { AssetsHttpError } from './assets-responses.js';

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

it('keeps fast recovery when old in-flight 404s finish after fresh record news', async () => {
  const requests: number[] = [];
  const rejects: ((error: unknown) => void)[] = [];
  const http: FollowerHttp = {
    record: () => {
      requests.push(Date.now());
      return new Promise((unused, reject) => {
        rejects.push(reject);
      });
    },
    events: () => Promise.resolve(),
  };
  const follower = new AssetFollower({ http: () => http, onRecord: () => undefined });
  const ids = Array.from({ length: 300 }, (unused, i) => String(i) as AssetId);
  for (const id of ids) follower.follow(id, undefined);
  follower.setVisible(new Set(ids));
  await vi.advanceTimersByTimeAsync(20000);
  expect(requests).toHaveLength(20);
  const first = '0' as AssetId;
  follower.learn(newFakeRecord(first, new Uint8Array([1]), 'ready'));
  for (const reject of rejects) reject(new AssetsHttpError(404, 'not-found', 'unknown'));
  await vi.advanceTimersByTimeAsync(15000);
  expect(requests).toHaveLength(32);
  follower.close();
});

it('does not treat capacity refusal as an unchanged result', async () => {
  const requests: number[] = [];
  const http: FollowerHttp = {
    record: () => {
      requests.push(Date.now());
      return Promise.reject(new AssetsHttpError(429, 'rate-limited', 'capacity'));
    },
    events: () => Promise.resolve(),
  };
  const follower = new AssetFollower({ http: () => http, onRecord: () => undefined });
  const ids = Array.from({ length: 300 }, (unused, i) => String(i) as AssetId);
  for (const id of ids) follower.follow(id, undefined);
  follower.setVisible(new Set(ids));
  await vi.advanceTimersByTimeAsync(30000);
  expect(requests).toHaveLength(28);
  follower.close();
});

it.each(['404', 'unchanged'] as const)(
  'ignores an old %s after unfollow and refollow',
  async (result) => {
    const requests: number[] = [];
    const finish: (() => void)[] = [];
    const http: FollowerHttp = {
      record: (id) => {
        requests.push(Date.now());
        return new Promise((resolve, reject) => {
          finish.push(() => {
            if (result === '404') reject(new AssetsHttpError(404, 'not-found', 'unknown'));
            else resolve(newFakeRecord(id, new Uint8Array([1]), 'processing'));
          });
        });
      },
      events: () => Promise.resolve(),
    };
    const follower = new AssetFollower({
      http: () => http,
      onRecord: () => undefined,
      maxStreams: 0,
    });
    const ids = Array.from({ length: 300 }, (unused, i) => String(i) as AssetId);
    for (const id of ids) follower.follow(id, newFakeRecord(id, new Uint8Array([1]), 'processing'));
    follower.setVisible(new Set(ids));
    await vi.advanceTimersByTimeAsync(15000);
    expect(requests).toHaveLength(16);
    for (const id of ids.slice(0, 16)) {
      follower.unfollow(id);
      follower.follow(id, newFakeRecord(id, new Uint8Array([1]), 'processing'));
    }
    for (const complete of finish) complete();
    await vi.advanceTimersByTimeAsync(15000);
    expect(requests).toHaveLength(28);
    follower.close();
  },
);

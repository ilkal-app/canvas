import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetId, AssetRecord } from '@canvas/schema';

import { newFakeRecord } from './__fixtures__/fake-asset-records.js';
import { AssetFollower, type FollowerHttp } from './asset-follower.js';
import { AssetsHttpError } from './assets-responses.js';
import {
  MAX_FOLLOW_ATTEMPTS,
  ON_SCREEN_MAX_DELAY_MS,
  POLL_BUDGET,
  POLL_INTERVAL_MS,
  WORST_CASE_POLLS_PER_MINUTE,
} from './poll-budget.js';

const MINUTE_MS = 60_000;

/**
 * An asset id for a number.
 *
 * @param index - The number.
 * @returns A distinct id.
 */
function assetNumber(index: number): AssetId {
  return createHash('sha256')
    .update(`on-screen ${String(index)}`)
    .digest('hex') as AssetId;
}

/**
 * A client on the fake timers whose records are `404` (a collaborator's upload still going)
 * until a time, then `ready`; every request is counted with its time.
 *
 * @param readyAt - When the upload verifies and the record is ready, ms; never by default.
 * @returns The client and its record requests.
 */
function uploadingElsewhere(readyAt = Number.POSITIVE_INFINITY) {
  const requests: { readonly assetId: AssetId; readonly at: number }[] = [];
  const http: FollowerHttp = {
    record: (assetId) => {
      requests.push({ assetId, at: Date.now() });
      return Date.now() < readyAt
        ? Promise.reject(new AssetsHttpError(404, 'not-found', 'unknown'))
        : Promise.resolve(newFakeRecord(assetId, new Uint8Array([1]), 'ready'));
    },
    events: () => Promise.reject(new AssetsHttpError(404, 'not-found', 'unknown')),
  };
  return { http, requests };
}

/**
 * A follower over a client, and the records it reports with their times.
 *
 * @param http - The client.
 * @returns The follower and the records.
 */
function followerOver(http: FollowerHttp) {
  const records: { readonly record: AssetRecord; readonly at: number }[] = [];
  const follower = new AssetFollower({
    http: () => http,
    onRecord: (record) => records.push({ record, at: Date.now() }),
  });
  return { follower, records };
}

/**
 * The gaps between request times.
 *
 * @param times - The times, ms, in order.
 * @returns Each gap, ms.
 */
function gapsOf(times: readonly number[]): number[] {
  return times.slice(1).map((at, index) => at - (times[index] ?? 0));
}

describe('AssetFollower on screen (fix round 2: a collaborator’s image shows)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('caps a lone visible asset eligibility at sixty seconds without giving up', async () => {
    const { http, requests } = uploadingElsewhere();
    const { follower } = followerOver(http);
    const asset = assetNumber(1);
    follower.follow(asset, undefined);
    follower.setVisible(new Set([asset]));
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
    expect(requests[0]?.at).toBe(0);
    const gaps = gapsOf(requests.map(({ at }) => at));
    expect(gaps.slice(0, 3)).toEqual([15_000, 30_000, 60_000]);
    expect(new Set(gaps.slice(2))).toEqual(new Set([60_000]));
    expect(requests.length).toBeGreaterThan(MAX_FOLLOW_ATTEMPTS);
    follower.close();
  });

  it('slows 300 visible unknown IDs below six polls per minute by two minutes', async () => {
    const { http, requests } = uploadingElsewhere();
    const { follower } = followerOver(http);
    const ids = new Set(Array.from({ length: 300 }, (unused, index) => assetNumber(index)));
    for (const id of ids) follower.follow(id, undefined);
    follower.setVisible(ids);
    await vi.advanceTimersByTimeAsync(300000);
    for (const start of [120000, 180000, 240000])
      expect(
        requests.filter(({ at }) => at >= start && at < start + MINUTE_MS).length,
      ).toBeLessThanOrEqual(6);
    const before = requests.length;
    follower.learn(newFakeRecord(assetNumber(0), new Uint8Array([1]), 'ready'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests.length - before).toBeGreaterThanOrEqual(4);
    follower.close();
  });

  it('revives a visible asset still in backoff without clearing shared capacity', async () => {
    const { http, requests } = uploadingElsewhere();
    let blockedUntil = 0;
    const { follower } = followerOver({
      ...http,
      get readWaitMs() {
        return Math.max(0, blockedUntil - Date.now());
      },
    });
    const asset = assetNumber(1);
    follower.follow(asset, undefined);
    follower.setVisible(new Set([asset]));
    await vi.advanceTimersByTimeAsync(110000);
    blockedUntil = 150000;
    follower.revive(asset);
    const before = requests.length;
    await vi.advanceTimersByTimeAsync(39999);
    expect(requests).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests.at(-1)?.at).toBe(150000);
    await vi.advanceTimersByTimeAsync(15000);
    expect(requests.at(-1)?.at).toBe(165000);
    follower.close();
  });

  it.each([
    { upload: '10 s', readyAt: 10_000 },
    { upload: '3 minutes', readyAt: 3 * MINUTE_MS },
    { upload: '40 minutes', readyAt: 40 * MINUTE_MS + 7000 },
  ])(
    'eventually shows an on-screen image after an upload of $upload verifying',
    async ({ readyAt }) => {
      const { http } = uploadingElsewhere(readyAt);
      const { follower, records } = followerOver(http);
      const asset = assetNumber(2);
      follower.follow(asset, undefined);
      follower.setVisible(new Set([asset]));
      await vi.advanceTimersByTimeAsync(readyAt + ON_SCREEN_MAX_DELAY_MS);
      expect(records.map(({ record }) => record.status)).toEqual(['ready']);
      expect(records[0]?.at).toBeLessThanOrEqual(readyAt + ON_SCREEN_MAX_DELAY_MS);
      if (readyAt === 10_000) expect(records[0]?.at).toBe(15_000);
      follower.close();
    },
  );

  it('restarts at once an asset it gave up on off screen when it comes on screen', async () => {
    const { http, requests } = uploadingElsewhere();
    const { follower } = followerOver(http);
    const asset = assetNumber(3);
    follower.follow(asset, undefined);
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
    expect(requests).toHaveLength(MAX_FOLLOW_ATTEMPTS);
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
    expect(requests).toHaveLength(MAX_FOLLOW_ATTEMPTS);
    const cameOnScreenAt = Date.now();
    follower.setVisible(new Set([asset]));
    await vi.advanceTimersByTimeAsync(0);
    expect(requests.at(-1)?.at).toBe(cameOnScreenAt);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(requests).toHaveLength(MAX_FOLLOW_ATTEMPTS + 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(MAX_FOLLOW_ATTEMPTS + 2);
    // Off screen again: back to the backoff, and given up on after its attempts.
    follower.setVisible(new Set());
    await vi.advanceTimersByTimeAsync(120 * MINUTE_MS);
    const settled = requests.length;
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
    expect(requests).toHaveLength(settled);
    follower.close();
  });

  it('keeps a waiting on-screen asset’s wait when the view changes but it stays on screen', async () => {
    const { http, requests } = uploadingElsewhere();
    const { follower } = followerOver(http);
    const [first, second] = [assetNumber(4), assetNumber(5)];
    follower.follow(first, undefined);
    follower.setVisible(new Set([first]));
    await vi.advanceTimersByTimeAsync(1000);
    follower.setVisible(new Set([first, second]));
    await vi.advanceTimersByTimeAsync(1000);
    // Only its first poll at once; the second call did not ask again.
    expect(requests).toHaveLength(1);
    follower.close();
  });

  it('starts a stream immediately on new record news during a long visible wait', async () => {
    const { http } = uploadingElsewhere();
    const asset = assetNumber(7);
    const ready = newFakeRecord(asset, new Uint8Array([1]), 'ready');
    const streaming: FollowerHttp = {
      ...http,
      events: (unused, receive) => {
        receive(ready);
        return Promise.resolve();
      },
    };
    const { follower, records } = followerOver(streaming);
    follower.follow(asset, undefined);
    follower.setVisible(new Set([asset]));
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);
    follower.learn({ ...ready, status: 'processing' });
    expect(records).toEqual([{ record: ready, at: 10 * MINUTE_MS }]);
    follower.close();
  });

  it('reduces repeated requests for 50 unchanged visible assets after the initial polls', async () => {
    const { http, requests } = uploadingElsewhere();
    const { follower } = followerOver(http);
    const visible = new Set(Array.from({ length: 50 }, (unused, index) => assetNumber(index)));
    for (const asset of visible) follower.follow(asset, undefined);
    follower.setVisible(visible);
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
    const late = requests.filter(({ at }) => at >= 30 * MINUTE_MS);
    expect(late.length).toBeLessThanOrEqual(350);
    expect(new Set(late.map(({ assetId }) => assetId))).toEqual(visible);
    follower.close();
  });

  it('restarts revisit and own-upload eligibility within the retained aggregate capacity', async () => {
    const { http, requests } = uploadingElsewhere();
    const { follower } = followerOver(http);
    const asset = assetNumber(6);
    follower.follow(asset, undefined);
    follower.setVisible(new Set([asset]));
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);
    follower.setVisible(new Set());
    follower.setVisible(new Set([asset]));
    const before = requests.length;
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(MINUTE_MS);
    expect(requests.length).toBeGreaterThan(before);
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);
    const uploadAt = Date.now();
    const beforeUpload = requests.length;
    follower.follow(asset, undefined, true);
    await vi.advanceTimersByTimeAsync(MINUTE_MS);
    expect(requests.length).toBeGreaterThan(beforeUpload);
    expect(requests[beforeUpload]?.at).toBeLessThanOrEqual(uploadAt + MINUTE_MS);
    follower.close();
  });

  it('serves 50 on-screen assets of 5,000 unknown first, in turn, within 48 requests a minute', async () => {
    const { http, requests } = uploadingElsewhere();
    const { follower } = followerOver(http);
    for (let index = 0; index < 5000; index += 1) follower.follow(assetNumber(index), undefined);
    const onScreen = new Set(
      Array.from({ length: 50 }, (unused, index) => assetNumber(index * 97)),
    );
    follower.setVisible(onScreen);
    await vi.advanceTimersByTimeAsync(15 * MINUTE_MS);
    const times = requests.map(({ at }) => at);
    for (const at of times) {
      const inMinute = times.filter((other) => other >= at && other < at + MINUTE_MS);
      expect(inMinute.length).toBeLessThanOrEqual(WORST_CASE_POLLS_PER_MINUTE);
      const inInterval = times.filter((other) => other >= at && other < at + POLL_INTERVAL_MS);
      expect(inInterval.length).toBeLessThanOrEqual(POLL_BUDGET);
    }
    // Visible assets rotate first. Saturation leaves no spare capacity for offscreen work.
    const firstRound = requests.slice(0, 50).map(({ assetId }) => assetId);
    expect(new Set(firstRound)).toEqual(onScreen);
    expect(requests.every(({ assetId }) => onScreen.has(assetId))).toBe(true);
    follower.setVisible(new Set());
    await vi.advanceTimersByTimeAsync(MINUTE_MS);
    expect(requests.some(({ assetId }) => !onScreen.has(assetId))).toBe(true);
    follower.close();
  });
});

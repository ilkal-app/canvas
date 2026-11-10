import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetId, AssetRecord } from '@canvas/schema';

import {
  FAKE_ASSETS_URL,
  FakeAssetsService,
  fakeToken,
} from './__fixtures__/fake-assets-service.js';
import { ManualSchedule, settle } from './__fixtures__/manual-schedule.js';
import { AssetFollower, type FollowerHttp } from './asset-follower.js';
import { AssetsHttp } from './assets-http.js';
import { AssetsHttpError } from './assets-responses.js';
import {
  FOLLOW_DELAYS_MS,
  MAX_FOLLOW_ATTEMPTS,
  POLL_BUDGET,
  POLL_INTERVAL_MS,
  WORST_CASE_POLLS_PER_MINUTE,
} from './poll-budget.js';
import { isSettledRecord } from './record-news.js';

const BYTES = new Uint8Array([3, 1, 4]);
const ASSET = createHash('sha256').update(BYTES).digest('hex') as AssetId;
const MINUTE_MS = 60_000;

/**
 * A follower over the fake, with a manual timer on its own clock.
 *
 * @returns The follower, the fake, the timer, the records read and the refusals reported.
 */
function setUp() {
  const service = new FakeAssetsService();
  const schedule = new ManualSchedule();
  const records: AssetRecord[] = [];
  let unauthorised = 0;
  const follower = new AssetFollower({
    http: () =>
      new AssetsHttp(
        { assetsUrl: FAKE_ASSETS_URL, boardId: 'board-a', token: fakeToken('board-a') },
        service.fetch,
      ),
    onRecord: (record) => records.push(record),
    onUnauthorised: () => (unauthorised += 1),
    schedule: schedule.schedule,
    now: () => schedule.now,
  });
  return { follower, service, schedule, records, unauthorised: () => unauthorised };
}

describe('AssetFollower', () => {
  it('follows nothing settled, nothing twice, and nothing once closed', async () => {
    const { follower, service, schedule } = setUp();
    service.seed(BYTES, ['board-a'], 'processing');
    const record = service.recordOf(ASSET);
    follower.follow(ASSET, { ...record, status: 'ready' });
    expect(schedule.pending).toEqual([]);
    follower.follow(ASSET, record);
    follower.follow(ASSET, record);
    await settle();
    expect(service.openStreams).toBe(1);
    follower.close();
    follower.follow(ASSET, record);
    await settle();
    expect(service.openStreams).toBe(0);
    expect(isSettledRecord({ ...record, status: 'failed' })).toBe(true);
  });

  it('streams at once when told of a record while it waits, and stops when told it settled', async () => {
    const { follower, service, schedule } = setUp();
    follower.follow(ASSET, undefined);
    // Never linked and not this page's upload: the slow rate.
    expect(schedule.pending).toEqual([15_000]);
    service.seed(BYTES, ['board-a'], 'processing');
    follower.learn(service.recordOf(ASSET));
    await settle();
    expect(schedule.pending).toEqual([]);
    expect(service.openStreams).toBe(1);
    follower.learn(service.recordOf(ASSET));
    follower.learn({ ...service.recordOf(ASSET), status: 'ready' });
    await settle();
    expect(service.openStreams).toBe(0);
    follower.learn({ ...service.recordOf(ASSET), id: 'other' as AssetId });
    follower.unfollow(ASSET);
  });

  it('polls again when the board can no longer read an asset whose stream it opens', async () => {
    const { follower, service, schedule, records } = setUp();
    service.seed(BYTES, ['board-a'], 'processing');
    service.failNext({ route: 'events', status: 404, code: 'not-found' });
    follower.follow(ASSET, service.recordOf(ASSET));
    await settle();
    // The stream was refused: wait, then (no record now) a poll due at once.
    expect(schedule.pending).toEqual([1000]);
    schedule.runAll();
    expect(schedule.pending).toEqual([0]);
    schedule.runAll();
    await settle();
    expect(records.at(-1)?.status).toBe('processing');
    expect(service.openStreams).toBe(1);
  });

  it('tells the adapter when the service refuses the token, from a poll or a stream', async () => {
    const { follower, service, unauthorised } = setUp();
    service.seed(BYTES, ['board-a'], 'processing');
    service.failNext({ route: 'events', status: 401, code: 'expired' });
    follower.follow(ASSET, service.recordOf(ASSET));
    await settle();
    expect(unauthorised()).toBe(1);
    const other = setUp();
    other.service.failNext({ route: 'record', status: 401, code: 'expired' });
    other.follower.follow(ASSET, undefined, true);
    other.schedule.runAll();
    await settle();
    expect(other.unauthorised()).toBe(1);
    follower.close();
    other.follower.close();
  });
});

/**
 * An asset id for a number.
 *
 * @param index - The number.
 * @returns A distinct id.
 */
function assetNumber(index: number): AssetId {
  return createHash('sha256').update(String(index)).digest('hex') as AssetId;
}

/**
 * A client that knows no asset: every record is `404` (an id never linked to the board), and
 * every request is counted with its time.
 *
 * @returns The client and its record requests with their times.
 */
function unknownAssets() {
  const requests: { readonly assetId: AssetId; readonly at: number }[] = [];
  const http: FollowerHttp = {
    record: (assetId) => {
      requests.push({ assetId, at: Date.now() });
      return Promise.reject(new AssetsHttpError(404, 'not-found', 'unknown'));
    },
    events: () => Promise.reject(new AssetsHttpError(404, 'not-found', 'unknown')),
  };
  return { http, requests };
}

describe('AssetFollower polls (fix round 1: bounded, on fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A follower on the fake timers over a client that knows no asset.
   *
   * @returns The follower and the client's requests.
   */
  function following() {
    const { http, requests } = unknownAssets();
    const follower = new AssetFollower({ http: () => http, onRecord: () => undefined });
    return { follower, requests };
  }

  it('starts an asset never linked, and not this page’s upload, at the slow rate', async () => {
    const { follower, requests } = following();
    follower.follow(assetNumber(1), undefined);
    follower.follow(assetNumber(2), undefined, true);
    await vi.advanceTimersByTimeAsync(14_999);
    // This page's upload is polled after 1 s; the stranger's not before 15 s.
    const timesOf = (assetId: AssetId) =>
      requests.filter((request) => request.assetId === assetId).map(({ at }) => at);
    expect(timesOf(assetNumber(2))[0]).toBe(1000);
    expect(timesOf(assetNumber(1))).toEqual([]);
    // Due at 15 s, it goes at the budget's next run, within one interval.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(timesOf(assetNumber(1))).toHaveLength(1);
    expect(timesOf(assetNumber(1))[0]).toBeGreaterThanOrEqual(15_000);
    follower.close();
  });

  it('backs off to minutes between the polls of an asset that stays unknown', async () => {
    const { follower, requests } = following();
    follower.follow(ASSET, undefined, true);
    await vi.advanceTimersByTimeAsync(30 * MINUTE_MS);
    const gaps = requests.slice(1).map(({ at }, index) => at - (requests[index]?.at ?? 0));
    // 2, 4, 8, 15 s… from each poll's answer (never within the budget's interval of the poll
    // before), up to five minutes.
    expect(gaps.slice(0, 4)).toEqual([POLL_INTERVAL_MS, POLL_INTERVAL_MS, 8000, 15_000]);
    expect(Math.max(...gaps)).toBe(FOLLOW_DELAYS_MS.at(-1));
    follower.close();
  });

  it('gives up after its attempts, until the asset is revived, learnt of or followed again', async () => {
    const { follower, requests } = following();
    follower.follow(ASSET, undefined, true);
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
    expect(requests).toHaveLength(MAX_FOLLOW_ATTEMPTS);
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
    expect(requests).toHaveLength(MAX_FOLLOW_ATTEMPTS);
    // Its object changed: followed again from the start.
    follower.revive(ASSET);
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests).toHaveLength(MAX_FOLLOW_ATTEMPTS + 1);
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
    expect(requests).toHaveLength(2 * MAX_FOLLOW_ATTEMPTS);
    // This page's upload of it verified: followed again.
    follower.follow(ASSET, undefined, true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests).toHaveLength(2 * MAX_FOLLOW_ATTEMPTS + 1);
    follower.close();
  });

  it('sends at most the budget of polls per interval across every asset', async () => {
    const { follower, requests } = following();
    for (let index = 0; index < 40; index += 1)
      follower.follow(assetNumber(index), undefined, true);
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);
    const times = requests.map(({ at }) => at);
    for (const at of times) {
      const inInterval = times.filter((other) => other >= at && other < at + POLL_INTERVAL_MS);
      expect(inInterval.length).toBeLessThanOrEqual(POLL_BUDGET);
    }
    // Round robin: every asset had its polls.
    expect(new Set(requests.map(({ assetId }) => assetId)).size).toBe(40);
    follower.close();
  });

  it('polls the assets of images on screen first', async () => {
    const { follower, requests } = following();
    for (let index = 0; index < 20; index += 1)
      follower.follow(assetNumber(index), undefined, true);
    follower.setVisible(new Set([assetNumber(17), assetNumber(18)]));
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests.slice(0, 2).map(({ assetId }) => assetId)).toEqual([
      assetNumber(17),
      assetNumber(18),
    ]);
    follower.close();
  });

  it('sends nothing while the page is hidden, and resumes once it shows', async () => {
    const { follower, requests } = following();
    follower.follow(ASSET, undefined, true);
    follower.setHidden(true);
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);
    expect(requests).toEqual([]);
    follower.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(1);
    follower.close();
  });

  it('sends at most the worst-case rate for a board of 5,000 unknown assets over ten minutes', async () => {
    const { follower, requests } = following();
    for (let index = 0; index < 5000; index += 1) follower.follow(assetNumber(index), undefined);
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);
    // Before the budget: 5,000 every 15 s, about 200,000 in ten minutes.
    expect(WORST_CASE_POLLS_PER_MINUTE).toBe(48);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.length).toBeLessThanOrEqual(10 * WORST_CASE_POLLS_PER_MINUTE);
    follower.close();
    const closedAt = requests.length;
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);
    expect(requests).toHaveLength(closedAt);
  });
});

// A collaborator's images on screen still processing (item 4): the source reports them to
// the page for their spinners, from the records its follower brings within's caps, and
// asks for nothing more to do so.
import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import {
  FAKE_ASSETS_URL,
  FakeAssetsService,
  fakeToken,
} from './__fixtures__/fake-assets-service.js';
import { ManualSchedule, settle } from './__fixtures__/manual-schedule.js';
import { HttpAssetSource } from './http-asset-source.js';
import { ON_SCREEN_MAX_DELAY_MS } from './poll-budget.js';

const BOARD = 'board-a';

/**
 * An image's bytes.
 *
 * @param seed - Makes the bytes differ.
 * @returns The bytes.
 */
function bytesOf(seed: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([seed, seed + 1, seed + 2]);
}

/**
 * A source over the fake, with a manual timer, recording its processing reports.
 *
 * @returns The source, the fake, the timer and the reports.
 */
function setUp() {
  const service = new FakeAssetsService();
  const schedule = new ManualSchedule();
  const reports: (readonly AssetId[])[] = [];
  const source = new HttpAssetSource(
    { assetsUrl: FAKE_ASSETS_URL, boardId: BOARD, token: fakeToken(BOARD) },
    {
      fetch: service.fetch,
      now: () => schedule.now,
      isAvifDecodable: Promise.resolve(true),
      schedule: schedule.schedule,
      onProcessing: (assetIds) => reports.push(assetIds),
    },
  );
  return { source, service, schedule, reports };
}

describe('HttpAssetSource: a collaborator’s images still processing', () => {
  it('reports the visible ones whose record says processing, until it says ready', async () => {
    const { source, service, schedule, reports } = setUp();
    const processing = service.seed(bytesOf(1), [BOARD], 'processing');
    const ready = service.seed(bytesOf(2), [BOARD], 'ready');
    await source.describe(processing);
    await source.describe(ready);
    // Not on screen: nothing to show.
    expect(reports).toEqual([]);
    source.setVisibleAssets(new Set([processing, ready]), new Set());
    expect(reports).toEqual([[processing]]);
    // The same report again changes nothing, and asks for nothing.
    const requests = service.requests.length;
    source.setVisibleAssets(new Set([ready, processing]), new Set());
    expect(reports).toHaveLength(1);
    expect(service.requests.length).toBe(requests);
    // Followed as before: its stream, and after a dropped stream, a poll within 60 s.
    source.subscribe(processing, () => undefined);
    await settle();
    expect(service.openStreams).toBe(1);
    service.dropStreams(processing);
    await settle();
    expect(schedule.pending.length).toBeGreaterThan(0);
    expect(Math.max(...schedule.pending)).toBeLessThanOrEqual(ON_SCREEN_MAX_DELAY_MS);
    service.update(processing, { status: 'ready', progress: 1 });
    schedule.runAll();
    await settle();
    expect(reports.at(-1)).toEqual([]);
  });

  it('leaves out the page’s own uploads, and reports nothing once the session ends', async () => {
    const { source, service, reports } = setUp();
    const own = service.seed(bytesOf(3), [BOARD], 'processing');
    const peer = service.seed(bytesOf(4), [BOARD], 'uploading');
    source.setVisibleAssets(new Set([own, peer]), new Set());
    source.uploaded(own);
    await source.describe(peer);
    await settle();
    expect(reports).toEqual([[peer]]);
    source.endSession();
    expect(reports.at(-1)).toEqual([]);
  });

  it('forgets them when destroyed, and needs no listener', async () => {
    const { source, service, reports } = setUp();
    const peer = service.seed(bytesOf(5), [BOARD], 'processing');
    source.setVisibleAssets(new Set([peer]), new Set());
    await source.describe(peer);
    source.destroy();
    expect(reports).toEqual([[peer], []]);
    const quiet = new HttpAssetSource(
      { assetsUrl: FAKE_ASSETS_URL, boardId: BOARD, token: fakeToken(BOARD) },
      { fetch: service.fetch, isAvifDecodable: Promise.resolve(true) },
    );
    quiet.setVisibleAssets(new Set([peer]), new Set());
    await quiet.describe(peer);
    expect(() => {
      quiet.destroy();
    }).not.toThrow();
  });
});

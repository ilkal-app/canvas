import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ImageAssetInfo } from '@canvas/engine';
import type { AssetId, AssetRecord } from '@canvas/schema';

import {
  FAKE_ASSETS_URL,
  FakeAssetsService,
  fakeToken,
} from './__fixtures__/fake-assets-service.js';
import { ManualSchedule, settle } from './__fixtures__/manual-schedule.js';
import { createHttpAssetSource, HttpAssetSource } from './http-asset-source.js';
import { SIGNED_URL_LIFETIME_MS } from './signed-fetch.js';

const BOARD = 'board-a';

/**
 * An image's bytes and id.
 *
 * @param seed - Makes the bytes differ.
 * @returns The bytes and their SHA-256.
 */
function image(seed: number): { bytes: Uint8Array<ArrayBuffer>; assetId: AssetId } {
  const bytes = new Uint8Array([seed, seed + 1, seed + 2]);
  return { bytes, assetId: createHash('sha256').update(bytes).digest('hex') as AssetId };
}

/**
 * A source over the fake, with a manual timer.
 *
 * @param options - Whether AVIF decodes, and the stream cap.
 * @param options.isAvif - Whether AVIF decodes; true by default.
 * @param options.maxStreams - The stream cap.
 * @returns The source, the fake, the timer and what the source reported.
 */
function setUp(options: { isAvif?: boolean; maxStreams?: number } = {}) {
  const service = new FakeAssetsService();
  const clock = { now: 0 };
  const schedule = new ManualSchedule();
  const statuses: AssetRecord['status'][] = [];
  let accessRequests = 0;
  const source = new HttpAssetSource(
    { assetsUrl: FAKE_ASSETS_URL, boardId: BOARD, token: fakeToken(BOARD) },
    {
      fetch: service.fetch,
      // The signed URLs' age (set by the tests) and the follower's waits (run by hand).
      now: () => clock.now + schedule.now,
      isAvifDecodable: Promise.resolve(options.isAvif ?? true),
      schedule: schedule.schedule,
      ...(options.maxStreams === undefined ? {} : { maxStreams: options.maxStreams }),
      requestAccess: () => (accessRequests += 1),
      onStatus: (record) => statuses.push(record.status),
    },
  );
  return { source, service, clock, schedule, statuses, accessRequests: () => accessRequests };
}

describe('HttpAssetSource', () => {
  it('describes a ready asset from its record, AVIF where it decodes, else WebP', async () => {
    const { source, service } = setUp();
    const { bytes, assetId } = image(1);
    service.seed(bytes, [BOARD]);
    expect(await source.describe(assetId)).toMatchObject({
      mimeType: 'image/png',
      naturalSize: { width: 1000, height: 500 },
      levels: [
        { longEdgePx: 128, format: 'avif' },
        { longEdgePx: 512, format: 'avif' },
      ],
      tiles: null,
    });
    const webpOnly = setUp({ isAvif: false });
    webpOnly.service.seed(bytes, [BOARD]);
    expect((await webpOnly.source.describe(assetId)).levels).toEqual([
      expect.objectContaining({ longEdgePx: 128, format: 'webp' }),
    ]);
    expect(source.boardId).toBe(BOARD);
  });

  it('opens nothing for a board whose images are ready, and nothing before a subscribe', async () => {
    const { source, service, schedule } = setUp();
    const { bytes, assetId } = image(1);
    service.seed(bytes, [BOARD]);
    await source.describe(assetId);
    source.subscribe(assetId, () => undefined);
    await settle();
    expect(service.openStreams).toBe(0);
    expect(schedule.pending).toEqual([]);
  });

  it('describes an asset the board cannot read yet as pending, and follows it until it can', async () => {
    const { source, service, schedule } = setUp();
    const { bytes, assetId } = image(2);
    const pending = await source.describe(assetId);
    expect(pending).toMatchObject({ naturalSize: null, levels: [] });
    const seen: ImageAssetInfo[] = [];
    source.subscribe(assetId, (info) => seen.push(info));
    // Never linked and not this page's upload: polled at the slow rate.
    expect(schedule.pending).toEqual([15_000]);
    schedule.runAll();
    await settle();
    expect(schedule.pending).toEqual([30_000]);
    // A collaborator's upload verifies; the next poll reads the record and streams its events.
    service.seed(bytes, [BOARD], 'processing');
    schedule.runAll();
    await settle();
    expect(service.openStreams).toBe(1);
    service.update(assetId, {
      status: 'ready',
      progress: 1,
      naturalSize: { width: 10, height: 10 },
      levels: [{ longEdgePx: 128, format: 'webp' }],
    });
    await settle();
    expect(seen.map((info) => info.levels.length)).toEqual([0, 0, 1]);
    expect(service.openStreams).toBe(0);
    expect(service.requests.every((request) => !request.isTokenInUrl)).toBe(true);
  });

  it('draws an image the page uploads from its bytes, then from the service once ready', async () => {
    const { source, service, statuses } = setUp();
    const { bytes, assetId } = image(3);
    source.addLocal({
      assetId,
      mimeType: 'image/png',
      naturalSize: { width: 30, height: 20 },
      file: new Blob([bytes]),
    });
    expect(await source.describe(assetId)).toMatchObject({
      mimeType: 'image/png',
      naturalSize: { width: 30, height: 20 },
      levels: [],
    });
    expect(new Uint8Array(await source.fetchOriginal(assetId))).toEqual(bytes);
    service.seed(bytes, [BOARD], 'processing');
    source.uploaded(assetId);
    await settle();
    expect((await source.describe(assetId)).naturalSize).toEqual({ width: 30, height: 20 });
    service.update(assetId, { progress: 0.5 });
    await settle();
    service.update(assetId, {
      status: 'ready',
      progress: 1,
      naturalSize: { width: 1000, height: 500 },
    });
    await settle();
    // The completion's read, the stream's first event (the same record), the change and `ready`.
    expect(statuses).toEqual(['processing', 'processing', 'processing', 'ready']);
    expect(new Uint8Array(await source.fetchOriginal(assetId))).toEqual(bytes);
    expect(service.requests.at(-1)?.path).toMatch(/\/original$/);
    source.addLocal({
      assetId,
      mimeType: 'image/png',
      naturalSize: { width: 1, height: 1 },
      file: new Blob([]),
    });
    expect((await source.describe(assetId)).naturalSize).toEqual({ width: 1000, height: 500 });
  });

  it('reads a record again once its signed URLs are old, and once more when one is refused', async () => {
    const { source, service, clock } = setUp();
    const { bytes, assetId } = image(4);
    service.seed(bytes, [BOARD]);
    await source.describe(assetId);
    const reads = () => service.requests.filter(({ path }) => path === '/assets/records').length;
    await source.fetchLevel(assetId, 128);
    expect(reads()).toBe(1);
    clock.now = SIGNED_URL_LIFETIME_MS;
    await source.fetchLevel(assetId, 512);
    expect(reads()).toBe(2);
    // The service's clock ran on: the kept URL is refused, read afresh and fetched.
    service.now = 3 * SIGNED_URL_LIFETIME_MS;
    await source.fetchLevel(assetId, 128);
    expect(reads()).toBe(3);
    service.signedUrlTtlMs = 0;
    service.now = 10 * SIGNED_URL_LIFETIME_MS;
    await expect(source.fetchLevel(assetId, 128)).rejects.toMatchObject({ status: 403 });
    expect(reads()).toBe(4);
    await expect(source.fetchLevel(assetId, 4096)).rejects.toThrow('no such file');
  });

  it('requires a new source for another board rather than sharing its cache and cooldown', () => {
    const { source } = setUp();
    expect(() => {
      source.setAccess({ assetsUrl: FAKE_ASSETS_URL, boardId: 'other', token: 'other' });
    }).toThrow('cannot switch boards');
    expect(source.boardId).toBe(BOARD);
    source.destroy();
  });

  it('fetches a tile from the signed URL its route answers, the token only on the route', async () => {
    const { source, service, clock } = setUp();
    const { bytes, assetId } = image(5);
    service.seed(bytes, [BOARD]);
    await expect(source.fetchTile(assetId, { level: 0, column: 0, row: 0 })).rejects.toThrow(
      'no tiles',
    );
    service.update(assetId, { tiles: { tileSizePx: 256, levels: 2, format: 'webp' } });
    clock.now = SIGNED_URL_LIFETIME_MS;
    const tile = await source.fetchTile(assetId, { level: 1, column: 2, row: 3 });
    expect(tile.byteLength).toBe(3);
    // The route signs the tile, with the board and the token; the bucket gets no token.
    expect(service.requests.slice(-2)).toMatchObject([
      {
        path: `/assets/${assetId}/tiles/1/2/3`,
        board: BOARD,
        authorization: `Bearer ${fakeToken(BOARD)}`,
      },
      { path: `/objects/${assetId}/tiles/1/2/3`, authorization: null },
    ]);
  });

  it('honours an aborted signal', async () => {
    const { source, service } = setUp();
    const { bytes, assetId } = image(6);
    service.seed(bytes, [BOARD]);
    source.addLocal({
      assetId,
      mimeType: 'image/png',
      naturalSize: { width: 1, height: 1 },
      file: new Blob([bytes]),
    });
    const controller = new AbortController();
    controller.abort();
    await expect(source.fetchOriginal(assetId, controller.signal)).rejects.toThrow();
  });

  it('asks the page for a fresh token when the service refuses it, then uses the new one', async () => {
    const { source, service, clock, accessRequests } = setUp();
    const { bytes, assetId } = image(7);
    service.seed(bytes, [BOARD]);
    service.failNext({ route: 'record', status: 401, code: 'expired' });
    expect((await source.describe(assetId)).levels).toEqual([]);
    expect(accessRequests()).toBe(1);
    source.setAccess({ assetsUrl: FAKE_ASSETS_URL, boardId: BOARD, token: fakeToken(BOARD) });
    clock.now = SIGNED_URL_LIFETIME_MS;
    await source.fetchLevel(assetId, 128);
  });

  it('rejects a describe only for an id the service calls malformed', async () => {
    const { source, service } = setUp();
    service.failNext({ route: 'record', status: 400, code: 'invalid-id' });
    await expect(source.describe(image(8).assetId)).rejects.toMatchObject({ status: 400 });
  });

  it('streams at most the cap at once, the rest waiting for a free stream', async () => {
    const { source, service, schedule } = setUp({ maxStreams: 1 });
    const first = image(9);
    const second = image(10);
    service.seed(first.bytes, [BOARD], 'processing');
    service.seed(second.bytes, [BOARD], 'processing');
    for (const { assetId } of [first, second]) {
      await source.describe(assetId);
      source.subscribe(assetId, () => undefined);
    }
    await settle();
    expect(service.openStreams).toBe(1);
    expect(schedule.pending).toEqual([1000]);
    service.update(first.assetId, { status: 'ready', progress: 1 });
    await settle();
    expect(service.openStreams).toBe(1);
    expect(schedule.pending).toEqual([]);
  });

  it('streams again after a stream ends early, resuming after its last event', async () => {
    const { source, service, schedule } = setUp();
    const { bytes, assetId } = image(11);
    service.seed(bytes, [BOARD], 'processing');
    await source.describe(assetId);
    const stop = source.subscribe(assetId, () => undefined);
    await settle();
    service.dropStreams(assetId);
    await settle();
    expect(schedule.pending).toEqual([1000]);
    schedule.runAll();
    await settle();
    expect(service.openStreams).toBe(1);
    const lastEvents = service.requests.filter(({ path }) => path.endsWith('/events'));
    expect(lastEvents).toHaveLength(2);
    stop();
    await settle();
    expect(service.openStreams).toBe(0);
  });

  it('passes the engine’s reports and the page’s visibility to its follower, before and after it starts', async () => {
    const { source, schedule } = setUp();
    const { assetId } = image(13);
    source.setHidden(true);
    source.setVisibleAssets(new Set([assetId]), new Set());
    await source.describe(assetId);
    source.subscribe(assetId, () => undefined);
    expect(schedule.pending).toEqual([]);
    source.setHidden(false);
    expect(schedule.pending).toEqual([15_000]);
    source.setVisibleAssets(new Set(), new Set());
    source.revive(assetId);
    source.destroy();
  });

  it('follows the page’s own verified upload at the quick rate', async () => {
    const { source, schedule, service } = setUp();
    const { assetId } = image(14);
    await source.describe(assetId);
    source.subscribe(assetId, () => undefined);
    expect(schedule.pending).toEqual([15_000]);
    service.failNext({ route: 'record', status: 404, code: 'not-found' });
    source.uploaded(assetId);
    await settle();
    expect(schedule.pending).toEqual([1000]);
    source.destroy();
  });

  it('forgets everything and ends its streams when destroyed', async () => {
    const { source, service } = setUp();
    const { bytes, assetId } = image(12);
    service.seed(bytes, [BOARD], 'processing');
    await source.describe(assetId);
    source.subscribe(assetId, () => undefined);
    await settle();
    expect(service.openStreams).toBe(1);
    source.destroy();
    await settle();
    expect(service.openStreams).toBe(0);
  });

  it('is made by its factory, follows without an access callback, and rethrows other failures', async () => {
    const service = new FakeAssetsService();
    const schedule = new ManualSchedule();
    const source = createHttpAssetSource(
      { assetsUrl: FAKE_ASSETS_URL, boardId: BOARD, token: fakeToken(BOARD) },
      { fetch: service.fetch, schedule: schedule.schedule, isAvifDecodable: Promise.resolve(true) },
    );
    const { bytes, assetId } = image(9);
    service.seed(bytes, [BOARD], 'processing');
    await source.describe(assetId);
    const unsubscribe = source.subscribe(assetId, () => undefined);
    service.update(assetId, { status: 'ready' });
    await settle();
    const ready = image(10);
    service.seed(ready.bytes, [BOARD]);
    service.failNext({ route: 'level', status: 500, code: 'broken' });
    await expect(source.fetchLevel(ready.assetId, 128)).rejects.toMatchObject({ status: 500 });
    unsubscribe();
    source.destroy();
  });
});

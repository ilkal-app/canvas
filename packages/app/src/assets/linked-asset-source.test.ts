import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { NO_IMAGE_ASSETS, type ImageAssetInfo } from '@canvas/engine';
import type { AssetId } from '@canvas/schema';

import {
  FAKE_ASSETS_URL,
  FakeAssetsService,
  fakeToken,
} from './__fixtures__/fake-assets-service.js';
import { ManualSchedule, settle } from './__fixtures__/manual-schedule.js';
import { directLinks, type AdapterAssetMessage } from './asset-channel.js';
import { LinkedAssetSource } from './linked-asset-source.js';

const BYTES = new Uint8Array([7, 7, 7]);
const ASSET = createHash('sha256').update(BYTES).digest('hex') as AssetId;

/**
 * A board's access on the fake.
 *
 * @param board - The board.
 * @returns The access.
 */
function access(board: string) {
  return { assetsUrl: FAKE_ASSETS_URL, boardId: board, token: fakeToken(board) };
}

/**
 * A linked source with the page's end in the test's hands.
 *
 * @returns The source, the page's end, the fake and what the page received.
 */
function setUp() {
  const service = new FakeAssetsService();
  const { page, adapter } = directLinks();
  const received: AdapterAssetMessage[] = [];
  page.listen((message) => received.push(message));
  const schedule = new ManualSchedule();
  const source = new LinkedAssetSource(adapter, {
    fallback: NO_IMAGE_ASSETS,
    fetch: service.fetch,
    isAvifDecodable: Promise.resolve(true),
    schedule: schedule.schedule,
    now: () => schedule.now,
  });
  return { source, page, service, received, schedule };
}

describe('LinkedAssetSource', () => {
  it('asks the page for the access at once, and waits for it before describing', async () => {
    const { source, page, service, received } = setUp();
    service.seed(BYTES, ['board-a']);
    await settle();
    expect(received).toEqual([{ type: 'access-request' }]);
    const describing = source.describe(ASSET);
    page.send({ type: 'access', access: access('board-a') });
    expect((await describing).levels).toHaveLength(2);
  });

  it('pauses the follower’s polls while the page is hidden, and passes on the engine’s reports', async () => {
    const { source, page, schedule } = setUp();
    page.send({ type: 'page-visibility', isHidden: true });
    page.send({ type: 'access', access: access('board-a') });
    source.setVisibleAssets(new Set([ASSET]), new Set());
    source.subscribe(ASSET, () => undefined);
    await source.describe(ASSET);
    await settle();
    expect(schedule.pending).toEqual([]);
    page.send({ type: 'page-visibility', isHidden: false });
    await settle();
    // Never linked, not this page's upload: the slow rate.
    expect(schedule.pending).toEqual([15_000]);
    source.revive(ASSET);
    source.close();
  });

  it('serves through the fallback while the page has no assets service', async () => {
    const { source, page, service } = setUp();
    page.send({ type: 'access', access: null });
    await expect(source.describe(ASSET)).rejects.toThrow('No asset source');
    await expect(source.fetchLevel(ASSET, 128)).rejects.toThrow();
    expect(service.requests).toEqual([]);
  });

  it('keeps the board on a token refresh, and describes again on a board switch', async () => {
    const { source, page, service } = setUp();
    service.seed(BYTES, ['board-b']);
    page.send({ type: 'access', access: access('board-a') });
    const seen: ImageAssetInfo[] = [];
    const stop = source.subscribe(ASSET, (info) => seen.push(info));
    expect((await source.describe(ASSET)).levels).toEqual([]);
    page.send({ type: 'access', access: access('board-a') });
    await settle();
    expect(seen).toEqual([]);
    page.send({ type: 'access', access: access('board-b') });
    await settle();
    expect(seen.at(-1)?.levels).toHaveLength(2);
    page.send({ type: 'access', access: null });
    await settle();
    // The fallback (none here) cannot describe it: its listeners keep what they had.
    expect(seen.at(-1)?.levels).toHaveLength(2);
    stop();
    page.send({ type: 'access', access: null });
  });

  it('draws the page’s local image, reports its upload’s status and asks again on a 401', async () => {
    const { source, page, service, received } = setUp();
    const image = {
      assetId: ASSET,
      mimeType: 'image/png',
      naturalSize: { width: 4, height: 3 },
      file: new Blob([BYTES]),
    };
    page.send({ type: 'local-image', image });
    page.send({ type: 'access', access: access('board-a') });
    expect((await source.describe(ASSET)).naturalSize).toEqual({ width: 4, height: 3 });
    expect(received).toContainEqual({ type: 'local-image-held', assetId: ASSET });
    page.send({ type: 'local-image', image: { ...image, naturalSize: { width: 5, height: 5 } } });
    await settle();
    expect((await source.describe(ASSET)).naturalSize).toEqual({ width: 5, height: 5 });
    service.seed(BYTES, ['board-a'], 'ready');
    page.send({ type: 'uploaded', assetId: ASSET });
    await settle();
    expect(received).toContainEqual({
      type: 'asset-status',
      assetId: ASSET,
      status: 'ready',
      progress: 1,
    });
    service.failNext({ route: 'record', status: 401, code: 'expired' });
    await source.describe('b'.repeat(64) as AssetId);
    expect(received.filter(({ type }) => type === 'access-request')).toHaveLength(2);
  });

  it('follows an upload the page reported before the board’s access came', async () => {
    const { page, service, received } = setUp();
    service.seed(BYTES, ['board-a'], 'ready');
    // A new engine for a page whose upload already verified: the page tells it at once, before
    // it asked for (and was given) the access.
    page.send({ type: 'uploaded', assetId: ASSET });
    page.send({ type: 'access', access: access('board-a') });
    await settle();
    expect(received).toContainEqual({
      type: 'asset-status',
      assetId: ASSET,
      status: 'ready',
      progress: 1,
    });
  });

  it('tells the page a collaborator’s images on screen still processing', async () => {
    const { source, page, service, received } = setUp();
    page.send({ type: 'access', access: access('board-a') });
    const peer = service.seed(BYTES, ['board-a'], 'processing');
    source.setVisibleAssets(new Set([peer]), new Set());
    await source.describe(peer);
    await settle();
    expect(received).toContainEqual({ type: 'processing', assetIds: [peer] });
    // Another board: the old board's images are no longer processing here.
    page.send({ type: 'access', access: access('board-b') });
    await settle();
    expect(received.filter(({ type }) => type === 'processing').at(-1)).toEqual({
      type: 'processing',
      assetIds: [],
    });
  });

  it('lets a local image go when the page drops its upload, before or after the access', async () => {
    const { source, page } = setUp();
    const image = {
      assetId: ASSET,
      mimeType: 'image/png',
      naturalSize: { width: 4, height: 3 },
      file: new Blob([BYTES]),
    };
    page.send({ type: 'local-image', image });
    page.send({ type: 'forget-local', assetId: ASSET });
    page.send({ type: 'access', access: access('board-a') });
    expect((await source.describe(ASSET)).naturalSize).toBeNull();
    page.send({ type: 'local-image', image });
    await settle();
    expect((await source.describe(ASSET)).naturalSize).toEqual({ width: 4, height: 3 });
    page.send({ type: 'forget-local', assetId: ASSET });
    await settle();
    await expect(source.fetchOriginal(ASSET)).rejects.toThrow();
  });

  it('fetches levels, tiles and the original through the board’s source', async () => {
    const { source, page, service } = setUp();
    service.seed(BYTES, ['board-a']);
    service.update(ASSET, { tiles: { tileSizePx: 256, levels: 1, format: 'webp' } });
    page.send({ type: 'access', access: access('board-a') });
    expect((await source.fetchLevel(ASSET, 128)).byteLength).toBe(1);
    expect((await source.fetchTile(ASSET, { level: 0, column: 0, row: 0 })).byteLength).toBe(3);
    expect(new Uint8Array(await source.fetchOriginal(ASSET))).toEqual(BYTES);
  });

  it('ends its streams and the link when closed, and ignores the page after', async () => {
    const { source, page, service, received } = setUp();
    service.seed(BYTES, ['board-a'], 'processing');
    page.send({ type: 'access', access: access('board-a') });
    await source.describe(ASSET);
    source.subscribe(ASSET, () => undefined);
    await settle();
    expect(service.openStreams).toBe(1);
    source.close();
    await settle();
    expect(service.openStreams).toBe(0);
    page.send({ type: 'access', access: access('board-b') });
    await settle();
    expect(received).toEqual([{ type: 'access-request' }]);
  });
});

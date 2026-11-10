import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import {
  FAKE_ASSETS_URL,
  FakeAssetsService,
  fakeToken,
} from './__fixtures__/fake-assets-service.js';
import { AssetsHttp } from './assets-http.js';
import { MAX_SIGNED_TILE_URLS, SignedTiles, TILE_URL_MARGIN_MS } from './signed-tiles.js';

const BOARD = 'board-a';
const BYTES = new Uint8Array([5, 6, 7]);
const ASSET = createHash('sha256').update(BYTES).digest('hex') as AssetId;
const TILE = { level: 0, column: 1, row: 2 };

/**
 * Signed tiles over the fake, on a clock the test moves.
 *
 * @returns The tiles, the fake, the clock and the token requests.
 */
function setUp() {
  const service = new FakeAssetsService();
  service.seed(BYTES, [BOARD]);
  service.update(ASSET, { tiles: { tileSizePx: 256, levels: 2, format: 'webp' } });
  const clock = { now: 0 };
  let unauthorised = 0;
  const tiles = new SignedTiles({
    http: () =>
      new AssetsHttp(
        { assetsUrl: FAKE_ASSETS_URL, boardId: BOARD, token: fakeToken(BOARD) },
        service.fetch,
      ),
    templateOf: () => Promise.resolve(`${FAKE_ASSETS_URL}/assets/${ASSET}/tiles/{z}/{x}/{y}`),
    now: () => clock.now,
    onUnauthorised: () => (unauthorised += 1),
  });
  const routeCalls = () =>
    service.requests.filter(({ path }) => path.startsWith('/assets/')).length;
  return { tiles, service, clock, routeCalls, unauthorised: () => unauthorised };
}

describe('SignedTiles', () => {
  it('keeps a tile’s signed URL until a minute before it expires, then signs it again', async () => {
    const { tiles, clock, routeCalls } = setUp();
    expect((await tiles.fetch(ASSET, TILE)).byteLength).toBe(3);
    await tiles.fetch(ASSET, TILE);
    expect(routeCalls()).toBe(1);
    clock.now = 900_000 - TILE_URL_MARGIN_MS;
    await tiles.fetch(ASSET, TILE);
    expect(routeCalls()).toBe(2);
  });

  it('signs a tile again once when the bucket refuses its URL', async () => {
    const { tiles, service, routeCalls } = setUp();
    await tiles.fetch(ASSET, TILE);
    // The bucket's clock ran past the URL's expiry.
    service.now = 1_000_000;
    await tiles.fetch(ASSET, TILE);
    expect(routeCalls()).toBe(2);
    service.failNext({ route: 'tile-object', status: 500, code: 'broken' });
    await expect(tiles.fetch(ASSET, TILE)).rejects.toMatchObject({ status: 500 });
  });

  it('asks for a fresh token when the route refuses this one, and has no tiles without a template', async () => {
    const { tiles, service, unauthorised } = setUp();
    service.failNext({ route: 'tile', status: 401, code: 'expired' });
    await expect(tiles.fetch(ASSET, TILE)).rejects.toMatchObject({ status: 401 });
    expect(unauthorised()).toBe(1);
    const none = new SignedTiles({
      http: () => new AssetsHttp({ assetsUrl: FAKE_ASSETS_URL, boardId: BOARD, token: '' }),
      templateOf: () => Promise.resolve(undefined),
      now: () => 0,
    });
    await expect(none.fetch(ASSET, TILE)).rejects.toThrow('no tiles');
  });

  it(`keeps at most ${String(MAX_SIGNED_TILE_URLS)} URLs, dropping the least recently signed`, async () => {
    const { tiles, routeCalls } = setUp();
    for (let column = 0; column <= MAX_SIGNED_TILE_URLS; column += 1) {
      await tiles.fetch(ASSET, { level: 0, column, row: 0 });
    }
    const signed = routeCalls();
    await tiles.fetch(ASSET, { level: 0, column: 0, row: 0 });
    expect(routeCalls()).toBe(signed + 1);
    tiles.clear();
    await tiles.fetch(ASSET, { level: 0, column: MAX_SIGNED_TILE_URLS, row: 0 });
    expect(routeCalls()).toBe(signed + 2);
  });
});

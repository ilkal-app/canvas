import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetId, AssetRecord } from '@canvas/schema';

import {
  FAKE_ASSETS_URL,
  FakeAssetsService,
  fakeToken,
} from './__fixtures__/fake-assets-service.js';
import { AssetsHttp } from './assets-http.js';
import { AssetsHttpError } from './assets-responses.js';

const BYTES = new Uint8Array([1, 2, 3, 4]);
const ASSET_ID = createHash('sha256').update(BYTES).digest('hex') as AssetId;

/**
 * A client of the fake for a board.
 *
 * @param service - The fake.
 * @param board - The board.
 * @returns The client.
 */
function client(service: FakeAssetsService, board = 'board-a'): AssetsHttp {
  return new AssetsHttp(
    { assetsUrl: FAKE_ASSETS_URL, boardId: board, token: fakeToken(board) },
    service.fetch,
  );
}

/**
 * The refusal a promise rejected with.
 *
 * @param promise - The promise.
 * @returns Its error.
 */
async function refusalOf(promise: Promise<unknown>): Promise<AssetsHttpError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AssetsHttpError)) throw new Error('Expected an AssetsHttpError.');
  return error;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AssetsHttp', () => {
  it('talks through the thread’s own fetch when given none', async () => {
    const service = new FakeAssetsService();
    service.seed(BYTES, ['board-a']);
    const threadFetch = vi.fn(service.fetch);
    vi.stubGlobal('fetch', threadFetch);
    const http = new AssetsHttp({
      assetsUrl: FAKE_ASSETS_URL,
      boardId: 'board-a',
      token: fakeToken('board-a'),
    });
    expect(await http.record(ASSET_ID)).toMatchObject({ id: ASSET_ID, status: 'ready' });
    expect(threadFetch).toHaveBeenCalledTimes(1);
    expect(threadFetch.mock.calls[0]?.[0]).toBe(
      `${FAKE_ASSETS_URL}/assets/${ASSET_ID}?board=board-a`,
    );
  });

  it('declares, puts through the signed URL, and completes an upload, which links the board', async () => {
    const service = new FakeAssetsService();
    const http = client(service);
    const declared = await http.declare({
      assetId: ASSET_ID,
      byteLength: 4,
      mimeType: 'image/png',
    });
    if (declared.status === 'linked') throw new Error('Expected an upload.');
    expect(declared).toMatchObject({ status: 'new', headers: { 'content-type': 'image/png' } });
    await service.fetch(declared.url, { method: 'PUT', body: BYTES });
    const record = await http.complete(ASSET_ID, declared.uploadId);
    expect(record).toMatchObject({ id: ASSET_ID, status: 'processing' });
    expect(service.isLinked(ASSET_ID, 'board-a')).toBe(true);
    expect(await http.declare({ assetId: ASSET_ID, byteLength: 4, mimeType: 'image/png' })).toEqual(
      {
        status: 'linked',
        asset: expect.objectContaining({ id: ASSET_ID }) as AssetRecord,
      },
    );
  });

  it('sends the token only in the Authorization header, and names the board in the query', async () => {
    const service = new FakeAssetsService();
    service.seed(BYTES, ['board-a']);
    await client(service).record(ASSET_ID);
    expect(service.requests).toEqual([
      {
        url: `${FAKE_ASSETS_URL}/assets/${ASSET_ID}?board=board-a`,
        method: 'GET',
        path: `/assets/${ASSET_ID}`,
        board: 'board-a',
        authorization: `Bearer ${fakeToken('board-a')}`,
        isTokenInUrl: false,
      },
    ]);
  });

  it('reports the service’s refusals with their code and Retry-After', async () => {
    const service = new FakeAssetsService();
    const http = client(service);
    expect(await refusalOf(http.record(ASSET_ID))).toMatchObject({
      status: 404,
      code: 'not-found',
    });
    service.failNext({ route: 'declare', status: 429, code: 'rate-limited', retryAfterS: 3 });
    const limited = await refusalOf(
      http.declare({ assetId: ASSET_ID, byteLength: 4, mimeType: 'image/png' }),
    );
    expect(limited).toMatchObject({ status: 429, code: 'rate-limited', retryAfterMs: 3000 });
    expect(limited.message).not.toContain('http');
  });

  it('refuses answers without a record, and a service that cannot be reached', async () => {
    const empty = new AssetsHttp({ assetsUrl: FAKE_ASSETS_URL, boardId: 'b', token: 't' }, () =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    expect((await refusalOf(empty.record(ASSET_ID))).code).toBe('invalid-record');
    expect(
      (await refusalOf(empty.declare({ assetId: ASSET_ID, byteLength: 1, mimeType: 'image/png' })))
        .code,
    ).toBe('invalid-declaration');
    const broken = new AssetsHttp({ assetsUrl: FAKE_ASSETS_URL, boardId: 'b', token: 't' }, () =>
      Promise.resolve(new Response('not json', { status: 500 })),
    );
    expect(await refusalOf(broken.record(ASSET_ID))).toMatchObject({ status: 500, code: 'http' });
    const offline = new AssetsHttp({ assetsUrl: FAKE_ASSETS_URL, boardId: 'b', token: 't' }, () =>
      Promise.reject(new TypeError('fetch failed')),
    );
    expect(await refusalOf(offline.record(ASSET_ID))).toMatchObject({ status: 0, code: 'network' });
  });

  it('keeps an abort an abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const http = new AssetsHttp({ assetsUrl: FAKE_ASSETS_URL, boardId: 'b', token: 't' }, () =>
      Promise.reject(new DOMException('aborted', 'AbortError')),
    );
    await expect(http.record(ASSET_ID, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('links an asset from a board that has it, with the source token in the body', async () => {
    const service = new FakeAssetsService();
    service.seed(BYTES, ['board-a']);
    const target = client(service, 'board-b');
    const record = await target.link(ASSET_ID, 'board-a', fakeToken('board-a'));
    expect(record.id).toBe(ASSET_ID);
    expect(service.isLinked(ASSET_ID, 'board-b')).toBe(true);
    const refused = await refusalOf(target.link(ASSET_ID, 'board-c', fakeToken('board-c')));
    expect(refused.status).toBe(404);
  });

  it('follows a record’s events until ready, without a Last-Event-ID', async () => {
    const service = new FakeAssetsService();
    service.seed(BYTES, ['board-a'], 'processing');
    const http = client(service);
    const seen: [string, number][] = [];
    const following = http.events(ASSET_ID, (record) => {
      seen.push([record.status, record.progress]);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    service.update(ASSET_ID, { progress: 0.5 });
    service.update(ASSET_ID, { status: 'ready', progress: 1 });
    await following;
    expect(seen).toEqual([
      ['processing', 0],
      ['processing', 0.5],
      ['ready', 1],
    ]);
    const again: string[] = [];
    await http.events(ASSET_ID, (record) => again.push(record.status));
    expect(again).toEqual(['ready']);
  });

  it('stops following when aborted, and closes the stream', async () => {
    const service = new FakeAssetsService();
    service.seed(BYTES, ['board-a'], 'processing');
    const controller = new AbortController();
    const following = client(service).events(ASSET_ID, () => undefined, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.openStreams).toBe(1);
    controller.abort();
    await following;
    expect(service.openStreams).toBe(0);
  });

  it('fetches signed bytes without the token, and tiles with it, on the service only', async () => {
    const service = new FakeAssetsService();
    service.seed(BYTES, ['board-a']);
    const http = client(service);
    const record = await http.record(ASSET_ID);
    const url = record.originalUrl ?? '';
    expect(new Uint8Array(await http.signed(url))).toEqual(BYTES);
    expect(service.requests.at(-1)?.authorization).toBeNull();
    service.now = 1_000_000;
    expect((await refusalOf(http.signed(url))).status).toBe(403);
    const tile = await http.tileUrl(`/assets/${ASSET_ID}/tiles/0/0/0`);
    expect(tile).toEqual({
      url: `${FAKE_ASSETS_URL}/objects/${ASSET_ID}/tiles/0/0/0?expires=1900000`,
      expiresInSeconds: 900,
    });
    expect(service.requests.at(-1)?.authorization).toBe(`Bearer ${fakeToken('board-a')}`);
    const foreign = await refusalOf(
      http.tileUrl(`https://elsewhere.test/assets/${ASSET_ID}/tiles/0/0/0`),
    );
    expect(foreign.code).toBe('foreign-url');
    const odd = new AssetsHttp(
      { assetsUrl: FAKE_ASSETS_URL, boardId: 'board-a', token: fakeToken('board-a') },
      () => Promise.resolve(new Response('{"url":3}')),
    );
    expect((await refusalOf(odd.tileUrl(`/assets/${ASSET_ID}/tiles/0/0/0`))).code).toBe(
      'invalid-tile',
    );
    expect(http.boardId).toBe('board-a');
  });
});

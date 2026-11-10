import { describe, expect, it } from 'vitest';

import {
  FAKE_ASSETS_URL,
  fakeToken,
  type FakeRequest,
} from './__fixtures__/fake-assets-service.js';
import { ManualSchedule, settle } from './__fixtures__/manual-schedule.js';
import { BOARD, png, setUp } from './__fixtures__/page-images-setup.js';
import { HttpAssetSource } from './http-asset-source.js';

// A board token never travels in a URL (Cloud Run's request log records full URLs); the
// asset client sends it only in `Authorization` headers, and reaches the bytes through signed
// URLs that carry none. Every request the page's images and the engine's asset source make to the
// fake service is scanned.

/**
 * Which of the service's routes and signed URLs a request is, for the coverage check.
 *
 * @param request - The request.
 * @returns Its kind.
 */
function kindOf(request: FakeRequest): string {
  const { method, path } = request;
  if (path.startsWith('/staging/')) return 'put';
  if (path.startsWith('/objects/')) {
    if (path.includes('/tiles/')) return 'tile bytes';
    return path.endsWith('/original') ? 'original bytes' : 'level bytes';
  }
  if (path === '/assets') return 'declare';
  if (path === '/assets/records') return 'records';
  const route = /^\/assets\/[0-9a-f]{64}(\/[a-z]+)?/.exec(path)?.[1] ?? '';
  return route === '' && method === 'GET' ? 'record' : route.slice(1);
}

/**
 * Every flow of the page's images and the engine's asset source against one fake: an upload
 * (declare, put, complete), a link from another board, the availability check's record, the
 * records, an event stream, a level, a tile and the original.
 *
 * @returns The requests the fake received.
 */
async function everyAssetRequest(): Promise<readonly FakeRequest[]> {
  const { images, service, target, copies } = setUp({ sources: ['board-b'] });
  await images.insert([png(1).file], { x: 0, y: 0 }, target);
  await settle();
  const copied = new Uint8Array([5, 1, 2, 3]);
  const copiedId = service.seed(copied, ['board-b']);
  copies.record([copiedId], 'board-b');
  await images.linkFrom([copiedId], 'board-b');
  // The image panel's availability check reads one record.
  await images.availability.availabilityOf(copiedId);

  const schedule = new ManualSchedule();
  const source = new HttpAssetSource(
    { assetsUrl: FAKE_ASSETS_URL, boardId: BOARD, token: fakeToken(BOARD) },
    {
      fetch: service.fetch,
      now: () => schedule.now,
      isAvifDecodable: Promise.resolve(true),
      schedule: schedule.schedule,
    },
  );
  const bytes = new Uint8Array([7, 8, 9]);
  const assetId = service.seed(bytes, [BOARD], 'processing');
  await source.describe(assetId);
  source.subscribe(assetId, () => undefined);
  await settle();
  service.update(assetId, {
    status: 'ready',
    progress: 1,
    naturalSize: { width: 6000, height: 4000 },
    levels: [{ longEdgePx: 128, format: 'avif' }],
    tiles: { tileSizePx: 256, levels: 1, format: 'webp' },
  });
  await settle();
  await source.fetchLevel(assetId, 128);
  await source.fetchTile(assetId, { level: 0, column: 0, row: 0 });
  await source.fetchOriginal(assetId);
  source.destroy();
  return service.requests;
}

describe('asset URLs', () => {
  it('never carry a board token, in any request the page or the engine makes', async () => {
    const requests = await everyAssetRequest();
    expect(new Set(requests.map(kindOf))).toEqual(
      new Set([
        'declare',
        'put',
        'complete',
        'link',
        'record',
        'records',
        'events',
        'tiles',
        'level bytes',
        'tile bytes',
        'original bytes',
      ]),
    );
    const leaking = requests.filter(({ url }) => /token|eyJ/i.test(decodeURIComponent(url)));
    expect(leaking).toEqual([]);
  });

  it('send the token in the header to the service’s routes, and nothing to signed URLs', async () => {
    const requests = await everyAssetRequest();
    for (const request of requests) {
      const isRoute = request.path.startsWith('/assets');
      const expected = isRoute ? `Bearer ${fakeToken(BOARD)}` : null;
      expect([request.path, request.authorization]).toEqual([request.path, expected]);
    }
  });
});

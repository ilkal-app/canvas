import { expect, it, vi } from 'vitest';

import type { AssetId, AssetRecord } from '@canvas/schema';

import { AssetsHttp } from './assets-http.js';

const first = 'a'.repeat(64) as AssetId;
const second = 'b'.repeat(64) as AssetId;
const record: AssetRecord = {
  id: first,
  mimeType: 'image/png',
  byteLength: 3,
  status: 'processing',
  naturalSize: null,
  levels: [],
  tiles: null,
  blurhash: null,
  averageColor: null,
  progress: 0,
  createdAt: 0,
};
function client(body: unknown) {
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 })),
  );
  const http = new AssetsHttp(
    { assetsUrl: 'https://assets.invalid', boardId: 'board', token: 'secret' },
    fetcher,
  );
  return { http, fetcher };
}
it('uses one authenticated bounded batch and retains ordered null results', async () => {
  const { http, fetcher } = client({ records: [record, null, record] });
  expect(await http.records([first, second, first])).toEqual([record, null, record]);
  expect(fetcher).toHaveBeenCalledWith(
    'https://assets.invalid/assets/records?board=board',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ids: [first, second, first] }),
    }),
  );
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
    'Bearer secret',
  );
});
it('rejects malformed count, order and records rather than assigning another asset', async () => {
  for (const body of [
    { records: [record] },
    { records: [null, record] },
    { records: [record, {}] },
    { records: [record, null], extra: true },
  ]) {
    await expect(client(body).http.records([first, second])).rejects.toThrow();
  }
});
it('rejects empty or oversized calls before transport', async () => {
  const { http, fetcher } = client({ records: [] });
  await expect(http.records([])).rejects.toThrow();
  await expect(http.records(Array.from({ length: 51 }, () => first))).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

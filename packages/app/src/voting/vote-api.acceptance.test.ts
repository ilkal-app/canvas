// CONTRACT: board, session and object IDs occupy one URL path segment each,
// even when they contain reserved characters; a cast keeps the object ID in the JSON body.
import { afterEach, expect, it, vi } from 'vitest';

import { voteApiFor } from './vote-api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('encodes odd IDs in every vote route without splitting path segments', async () => {
  const calls: { path: string; method: string; body: string | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method ?? 'GET', body: init?.body as string | undefined });
      return Promise.resolve(
        new Response(JSON.stringify({ session: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }),
  );
  const api = voteApiFor('board /?#%');
  await api.read();
  await api.start(3);
  await api.cast('session /?#%', 'sticky /?#%');
  await api.retract('session /?#%', 'sticky /?#%');
  await api.reveal('session /?#%');
  await api.end('session /?#%');
  const base = '/api/boards/board%20%2F%3F%23%25/votes';
  const session = `${base}/session%20%2F%3F%23%25`;
  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
    `GET ${base}`,
    `POST ${base}`,
    `POST ${session}/votes`,
    `DELETE ${session}/votes/sticky%20%2F%3F%23%25`,
    `POST ${session}/reveal`,
    `POST ${session}/end`,
  ]);
  expect(calls[2]?.body).toBe(JSON.stringify({ objectId: 'sticky /?#%' }));
});

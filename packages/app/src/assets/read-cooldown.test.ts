import { afterEach, expect, it, vi } from 'vitest';

import { ImageLoadDeferredError } from '@canvas/engine';
import type { AssetId } from '@canvas/schema';

import { AssetsHttp } from './assets-http.js';
import { AssetsHttpError, refusal } from './assets-responses.js';
import { withImageCapacity } from './image-read-capacity.js';
import { ReadCooldown } from './read-cooldown.js';

const id = 'a'.repeat(64) as AssetId;
afterEach(() => vi.useRealTimers());

it('starts the read wait when 429 headers arrive even if its error body is still pending', async () => {
  let closeBody: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      closeBody = () => {
        controller.enqueue(new TextEncoder().encode('{}'));
        controller.close();
      };
    },
  });
  const fetcher = vi.fn(() =>
    Promise.resolve(
      new Response(body, {
        status: 429,
        headers: { 'retry-after': '60' },
      }),
    ),
  );
  const http = new AssetsHttp(
    { assetsUrl: 'https://assets.invalid', boardId: 'board', token: 'token' },
    fetcher,
  );
  const first = http.records([id]).catch((error: unknown) => error);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(http.readWaitMs).toBeGreaterThan(59_000);
  await expect(http.record(id)).rejects.toMatchObject({ status: 429 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  closeBody?.();
  expect(await first).toBeInstanceOf(AssetsHttpError);
});

it('shares a board read deadline across batches, polls, events, tiles and token refresh', async () => {
  let now = 0;
  const cooldown = new ReadCooldown(() => now);
  const fetcher = vi.fn(() =>
    Promise.resolve(new Response('{}', { status: 429, headers: { 'retry-after': '60' } })),
  );
  const access = { assetsUrl: 'https://assets.invalid', boardId: 'board', token: 'old' };
  const http = new AssetsHttp(access, fetcher, cooldown);
  await expect(http.records([id])).rejects.toMatchObject({ retryAfterMs: 60_000 });
  now = 10_000;
  const refreshed = new AssetsHttp({ ...access, token: 'new' }, fetcher, cooldown);
  for (const request of [
    () => http.record(id),
    () => http.events(id, () => undefined),
    () => refreshed.records([id]),
    () => refreshed.tileUrl(`/assets/${id}/tiles/0/0/0`),
  ]) {
    await expect(request()).rejects.toMatchObject({ status: 429, retryAfterMs: 50_000 });
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
  const abort = new AbortController();
  abort.abort();
  await expect(http.record(id, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  // Mutations have independent server budgets and do not inherit a read wait.
  await expect(http.complete(id, 'upload')).rejects.toMatchObject({ status: 429 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  now = 60_000;
  await expect(refreshed.records([id])).rejects.toMatchObject({ status: 429 });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('extends deadlines monotonically and uses a bounded fallback for malformed waits', () => {
  let now = 0;
  const cooldown = new ReadCooldown(() => now);
  cooldown.observe(new AssetsHttpError(429, 'limited', '', 60_000));
  now = 10_000;
  cooldown.observe(new AssetsHttpError(429, 'limited', '', 1000));
  cooldown.observe(new AssetsHttpError(500, 'failed', '', 90_000));
  expect(cooldown.remainingMs).toBe(50_000);
  now = 60_000;
  cooldown.observe(new AssetsHttpError(429, 'limited', '', Number.NaN));
  expect(cooldown.remainingMs).toBe(1000);
});

it('parses seconds and HTTP dates without treating negative waits as dates', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  for (const [header, expected] of [
    ['60', 60_000],
    ['Thu, 01 Jan 2026 00:01:00 GMT', 60_000],
    ['-1', undefined],
    ['garbage', undefined],
  ] as const) {
    await expect(
      refusal(new Response('{}', { status: 429, headers: { 'retry-after': header } })),
    ).rejects.toMatchObject({ retryAfterMs: expected });
  }
});

it('maps only capacity refusals to timer-sized image deferrals', async () => {
  for (const [delay, expected] of [
    [60_000, 60_000],
    [1e12, 2_147_483_647],
    [NaN, 1000],
  ]) {
    await expect(
      withImageCapacity(Promise.reject(new AssetsHttpError(429, 'limited', '', delay))),
    ).rejects.toEqual(new ImageLoadDeferredError(expected ?? 1000));
  }
  const failure = new AssetsHttpError(503, 'unavailable', '', 60_000);
  await expect(withImageCapacity(Promise.reject(failure))).rejects.toBe(failure);
  const bytes = new ArrayBuffer(3);
  expect(await withImageCapacity(Promise.resolve(bytes))).toBe(bytes);
});

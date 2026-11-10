import { afterEach, expect, it, vi } from 'vitest';

import type { AssetId, AssetRecord } from '@canvas/schema';

import { AssetsHttpError } from './assets-responses.js';
import { RecordReads } from './record-reads.js';

const id = (index: number) => index.toString(16).padStart(64, '0') as AssetId;
const record = (assetId: AssetId): AssetRecord => ({
  id: assetId,
  mimeType: 'image/png',
  byteLength: 3,
  status: 'ready',
  naturalSize: { width: 1, height: 1 },
  levels: [],
  tiles: null,
  blurhash: null,
  averageColor: null,
  progress: 1,
  createdAt: 0,
});
afterEach(() => {
  vi.useRealTimers();
});
it.each(['completion', 'capacity refusal'] as const)(
  'ignores an old %s after clear and same-asset reuse',
  async (outcome) => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const batch = vi
      .fn<(ids: readonly AssetId[]) => Promise<(AssetRecord | null)[]>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            // Deliberately ignores abort: an old transport must not mutate the new queue.
            finish = () => {
              if (outcome === 'completion') resolve([{ ...record(id(1)), progress: 0 }]);
              else reject(new AssetsHttpError(429, 'limited', '', 60_000));
            };
          }),
      )
      .mockImplementation((ids) => Promise.resolve(ids.map(record)));
    const reads = new RecordReads((assetId) => Promise.resolve(record(assetId)), 1, batch);
    const old = Promise.allSettled([reads.read(id(1))]);
    await vi.advanceTimersByTimeAsync(0);
    reads.clear();
    const fresh = reads.read(id(1));
    await vi.advanceTimersByTimeAsync(0);
    finish?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(batch).toHaveBeenCalledTimes(2);
    expect(await fresh).toEqual(record(id(1)));
    expect(await old).toMatchObject([{ status: 'rejected' }]);
  },
);
it('loads a thousand unique descriptions in fifty-ID batches with at most twelve calls', async () => {
  const batches: AssetId[][] = [];
  const release: (() => void)[] = [];
  let active = 0;
  let maximum = 0;
  const reads = new RecordReads(
    () => Promise.reject(new Error('Single read unexpected')),
    12,
    (ids) =>
      new Promise((resolve) => {
        batches.push([...ids]);
        active += 1;
        maximum = Math.max(maximum, active);
        release.push(() => {
          active -= 1;
          resolve(ids.map(record));
        });
      }),
  );
  const pending = Promise.all(
    Array.from({ length: 1000 }, (unused, index) => reads.read(id(index))),
  );
  await vi.waitFor(() => {
    expect(batches).toHaveLength(12);
  });
  expect(reads.inFlightCount).toBe(12);
  for (const finish of release.splice(0)) finish();
  await vi.waitFor(() => {
    expect(batches).toHaveLength(20);
  });
  for (const finish of release.splice(0)) finish();
  expect(await pending).toHaveLength(1000);
  expect(maximum).toBe(12);
  expect(batches.every((batch) => batch.length === 50)).toBe(true);
});
it('waits beyond the transport timeout on429 without rejecting or sending early', async () => {
  vi.useFakeTimers();
  const batch = vi
    .fn<(ids: readonly AssetId[], signal: AbortSignal) => Promise<(AssetRecord | null)[]>>()
    .mockRejectedValueOnce(new AssetsHttpError(429, 'rate-limited', 'wait', 60_000))
    .mockImplementation((ids) => Promise.resolve(ids.map(record)));
  const reads = new RecordReads((assetId) => Promise.resolve(record(assetId)), 12, batch);
  const pending = reads.read(id(1));
  await vi.advanceTimersByTimeAsync(0);
  expect(reads.inFlightCount).toBe(0);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(batch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toEqual(record(id(1)));
  expect(batch).toHaveBeenCalledTimes(2);
});
it('maps null to one caller refusal while retaining its batch peers', async () => {
  const reads = new RecordReads(
    (assetId) => Promise.resolve(record(assetId)),
    12,
    (ids) => Promise.resolve(ids.map((assetId) => (assetId === id(1) ? null : record(assetId)))),
  );
  const outcomes = await Promise.allSettled([reads.read(id(1)), reads.read(id(2))]);
  expect(outcomes[0]).toMatchObject({ status: 'rejected', reason: { status: 404 } });
  expect(outcomes[1]).toMatchObject({ status: 'fulfilled', value: record(id(2)) });
});

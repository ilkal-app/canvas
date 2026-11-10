import { expect, it, vi } from 'vitest';

import type { AssetId, AssetRecord } from '@canvas/schema';

import { ManualSchedule, settle } from './__fixtures__/manual-schedule.js';
import { AssetFollower } from './asset-follower.js';
import { AssetsHttpError } from './assets-responses.js';
import { MAX_FOLLOW_ATTEMPTS } from './poll-budget.js';

const id = 'a'.repeat(64) as AssetId;
const processing: AssetRecord = {
  id,
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

it.each(['poll', 'stream'] as const)(
  'waits through repeated %s capacity refusals without giving up',
  async (mode) => {
    const schedule = new ManualSchedule();
    let waits = MAX_FOLLOW_ATTEMPTS + 3;
    const records: AssetRecord[] = [];
    const read = vi.fn(() => {
      if (waits-- > 0) return Promise.reject(new AssetsHttpError(429, 'limited', '', 60_000));
      return Promise.resolve({ ...processing, status: 'ready' as const });
    });
    const follower = new AssetFollower({
      http: () => ({
        record: read,
        events: async (assetId, onRecord) => {
          expect(assetId).toBe(id);
          onRecord(await read());
        },
      }),
      onRecord: (record) => records.push(record),
      schedule: schedule.schedule,
      now: () => schedule.now,
    });
    follower.follow(id, mode === 'stream' ? processing : undefined);
    if (mode === 'poll') schedule.runAll();
    await settle();
    for (let index = 0; index < MAX_FOLLOW_ATTEMPTS + 3; index += 1) {
      expect(read).toHaveBeenCalledTimes(index + 1);
      expect(schedule.pending).toEqual([60_000]);
      schedule.runAll();
      await settle();
    }
    expect(records).toEqual([{ ...processing, status: 'ready' }]);
    expect(schedule.pending).toEqual([]);
    follower.close();
  },
);

it('cancels a capacity wait when the follower is closed', async () => {
  const schedule = new ManualSchedule();
  const read = vi.fn(() => Promise.reject(new AssetsHttpError(429, 'limited', '', 60_000)));
  const follower = new AssetFollower({
    http: () => ({ record: read, events: () => Promise.resolve() }),
    onRecord: () => undefined,
    schedule: schedule.schedule,
    now: () => schedule.now,
  });
  follower.follow(id, undefined);
  schedule.runAll();
  await settle();
  expect(schedule.pending).toEqual([60_000]);
  follower.close();
  schedule.runAll();
  expect(read).toHaveBeenCalledTimes(1);
});

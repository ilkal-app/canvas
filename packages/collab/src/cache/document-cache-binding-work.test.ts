import { expect, it } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { addStickies } from './__fixtures__/sticky-board.js';
import { CacheWriteTracker } from './cache-write-tracker.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';

const BOARD = 'board-1';

it('waits for a due compaction as well as the appends, when asked for its work', async () => {
  const storage = new MemoryCacheStorage();
  const store = new YjsDocumentStore();
  const idle: (() => void)[] = [];
  const binding = await DocumentCacheBinding.open({
    store,
    cache: new MemoryDocumentCache(storage),
    boardId: BOARD,
    compactEvery: 3,
    idleScheduler: {
      schedule: (callback) => {
        idle.push(callback);
        return { cancel: () => undefined };
      },
    },
  });
  addStickies(store, 3, { batchSize: 1 });
  await binding.writes.settled();
  // The appends are in; the compaction they called for waits for idle time.
  let isWorkDone = false;
  const work = binding.writes.workSettled?.().then(() => {
    isWorkDone = true;
  });
  await Promise.resolve();
  expect(isWorkDone).toBe(false);
  expect(storage.board(BOARD).snapshot).toBeUndefined();
  for (const run of idle.splice(0)) run();
  await work;
  expect(isWorkDone).toBe(true);
  expect(storage.board(BOARD).snapshot).toBeDefined();
  await expect(binding.writes.workSettled?.()).resolves.toBeUndefined();
  binding.destroy();
});

it('settles at once after the binding is destroyed', async () => {
  const store = new YjsDocumentStore();
  const binding = await DocumentCacheBinding.open({
    store,
    cache: new MemoryDocumentCache(new MemoryCacheStorage()),
    boardId: BOARD,
    compactEvery: 1,
    idleScheduler: { schedule: () => ({ cancel: () => undefined }) },
  });
  addStickies(store, 1, { batchSize: 1 });
  binding.destroy();
  await expect(binding.writes.workSettled?.()).resolves.toBeUndefined();
});

it('waits for the writes alone on a tracker told nothing else', async () => {
  const tracker = new CacheWriteTracker();
  let finish = (): void => undefined;
  void tracker.track(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  let isDone = false;
  const done = tracker.workSettled().then(() => {
    isDone = true;
  });
  await Promise.resolve();
  expect(isDone).toBe(false);
  finish();
  await done;
  expect(isDone).toBe(true);
});

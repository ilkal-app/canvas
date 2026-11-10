import { expect, it, vi } from 'vitest';

import { StoreBusyError, YjsDocumentStore } from '@canvas/document';

import { ManualTime } from '../presence/__fixtures__/manual-time.js';

import { addStickies } from './__fixtures__/sticky-board.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';

const BOARD = 'board-1';

it('waits for a held run before applying a loaded cached board', async () => {
  const storage = new MemoryCacheStorage();
  const seeded = new YjsDocumentStore();
  addStickies(seeded, 2);
  await new MemoryDocumentCache(storage).append(BOARD, seeded.encodeState());
  const store = new YjsDocumentStore();
  const cache = new MemoryDocumentCache(storage);
  const load = vi.spyOn(cache, 'load');
  const changes = vi.fn();
  store.subscribe(changes);
  const run = store.beginRun();
  const opening = DocumentCacheBinding.open({ store, cache, boardId: BOARD });
  const outcome = opening.then(
    (binding) => ({ binding }),
    (error: unknown) => ({ error }),
  );
  await vi.waitFor(() => {
    expect(load).toHaveBeenCalledOnce();
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(store.read().objects.size).toBe(0);
  run.close();
  const result = await outcome;
  expect(result).toHaveProperty('binding');
  if (!('binding' in result)) return;
  const { binding } = result;
  expect(store.read().objects.size).toBe(2);
  expect(changes).toHaveBeenCalledOnce();
  binding.destroy();
  store.destroy();
  seeded.destroy();
});

it('rejects an open when the store is destroyed during its idle wait without applying the cache', async () => {
  const storage = new MemoryCacheStorage();
  const seeded = new YjsDocumentStore();
  addStickies(seeded, 2);
  await new MemoryDocumentCache(storage).append(BOARD, seeded.encodeState());
  const store = new YjsDocumentStore();
  const cache = new MemoryDocumentCache(storage);
  const load = vi.spyOn(cache, 'load');
  const apply = vi.spyOn(store, 'applyUpdate');
  const run = store.beginRun();
  const opening = DocumentCacheBinding.open({ store, cache, boardId: BOARD });
  const outcome = opening.then(
    (binding) => ({ binding }),
    (error: unknown) => ({ error }),
  );
  await vi.waitFor(() => {
    expect(load).toHaveBeenCalledOnce();
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(store.read().objects.size).toBe(0);
  store.destroy();
  const result = await outcome;
  expect(result).toHaveProperty('error');
  expect(apply).not.toHaveBeenCalled();
  if ('binding' in result) result.binding.destroy();
  run.close();
  seeded.destroy();
});

it('waits for a held run before restoring a newer snapshot after compaction conflict', async () => {
  const storage = new MemoryCacheStorage();
  const cache = new MemoryDocumentCache(storage);
  const otherCache = new MemoryDocumentCache(storage);
  const store = new YjsDocumentStore();
  const other = new YjsDocumentStore();
  const time = new ManualTime();
  const errors: unknown[] = [];
  const binding = await DocumentCacheBinding.open({
    store,
    cache,
    boardId: BOARD,
    idleScheduler: time,
    idleTimeoutMs: 1,
    onError: (error) => errors.push(error),
  });
  const otherBinding = await DocumentCacheBinding.open({
    store: other,
    cache: otherCache,
    boardId: BOARD,
  });
  addStickies(store, 1);
  addStickies(other, 1, { seed: 9 });
  await otherBinding.compact();
  const loaded = vi.fn();
  const originalLoad = cache.load.bind(cache);
  let releaseLoad!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  vi.spyOn(cache, 'load').mockImplementation(async (boardId) => {
    loaded();
    await gate;
    return originalLoad(boardId);
  });
  const compaction = binding.compact();
  time.advanceBy(1);
  await vi.waitFor(() => {
    expect(loaded).toHaveBeenCalledOnce();
  });
  const run = store.beginRun();
  releaseLoad();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(store.read().objects.size).toBe(1);
  expect(errors).toEqual([]);
  run.close();
  await compaction;
  expect(errors).not.toContainEqual(expect.any(StoreBusyError));
  expect(errors).toEqual([]);
  expect(store.read().objects.size).toBe(2);
  binding.destroy();
  otherBinding.destroy();
  store.destroy();
  other.destroy();
});

it('drops a compaction recovery restore when its binding is destroyed during the wait', async () => {
  const storage = new MemoryCacheStorage();
  const cache = new MemoryDocumentCache(storage);
  const otherCache = new MemoryDocumentCache(storage);
  const store = new YjsDocumentStore();
  const other = new YjsDocumentStore();
  const time = new ManualTime();
  const errors: unknown[] = [];
  const binding = await DocumentCacheBinding.open({
    store,
    cache,
    boardId: BOARD,
    idleScheduler: time,
    idleTimeoutMs: 1,
    onError: (error) => errors.push(error),
  });
  const otherBinding = await DocumentCacheBinding.open({
    store: other,
    cache: otherCache,
    boardId: BOARD,
  });
  addStickies(store, 1);
  addStickies(other, 1, { seed: 9 });
  await otherBinding.compact();
  const loaded = vi.fn();
  const originalLoad = cache.load.bind(cache);
  let releaseLoad!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  vi.spyOn(cache, 'load').mockImplementation(async (boardId) => {
    loaded();
    await gate;
    return originalLoad(boardId);
  });
  const compaction = binding.compact();
  time.advanceBy(1);
  await vi.waitFor(() => {
    expect(loaded).toHaveBeenCalledOnce();
  });
  const run = store.beginRun();
  releaseLoad();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  binding.destroy();
  run.close();
  await compaction;
  expect(errors).toEqual([]);
  expect(store.read().objects.size).toBe(1);
  otherBinding.destroy();
  store.destroy();
  other.destroy();
});

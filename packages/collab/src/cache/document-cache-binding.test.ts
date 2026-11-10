import { describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore, type ChangeSet } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { ManualTime } from '../presence/__fixtures__/manual-time.js';

import { addStickies, sticky } from './__fixtures__/sticky-board.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';

const BOARD = 'board-1';

async function openBinding(
  cache: MemoryDocumentCache,
  store = new YjsDocumentStore(),
  compactEvery = 500,
) {
  const binding = await DocumentCacheBinding.open({ store, cache, boardId: BOARD, compactEvery });
  return { binding, store };
}

describe('DocumentCacheBinding', () => {
  it('stores every update, local and remote, and restores the board into a new store', async () => {
    const storage = new MemoryCacheStorage();
    const { binding, store } = await openBinding(new MemoryDocumentCache(storage));
    const ids = addStickies(store, 3, { batchSize: 1 });
    const peer = new YjsDocumentStore();
    addStickies(peer, 2, { seed: 9 });
    store.applyUpdate(peer.encodeState(), { kind: 'system', principalId: 'system' as never });
    await binding.flush();

    const { store: reopened } = await openBinding(new MemoryDocumentCache(storage));
    expect(reopened.read().objects.size).toBe(5);
    expect(reopened.get(ids[0] ?? ('' as never))).toEqual(store.get(ids[0] ?? ('' as never)));
  });

  it('restores a cached board in two change sets at most: the snapshot, then the updates after it', async () => {
    const storage = new MemoryCacheStorage();
    const { binding, store } = await openBinding(new MemoryDocumentCache(storage));
    addStickies(store, 6, { batchSize: 2 });
    await binding.compact();
    addStickies(store, 4, { batchSize: 1, seed: 2 });
    await binding.flush();
    const reopened = new YjsDocumentStore();
    const changeSets = vi.fn();
    reopened.subscribe(changeSets);
    await openBinding(new MemoryDocumentCache(storage), reopened);
    expect(changeSets).toHaveBeenCalledTimes(2);
    expect(changeSets.mock.calls.map(([changes]) => (changes as ChangeSet).created.length)).toEqual(
      [6, 4],
    );
    expect(changeSets.mock.calls[0]?.[0]).toMatchObject({ isLocal: false });
  });

  it('does not store the updates it restores again', async () => {
    const storage = new MemoryCacheStorage();
    const { binding, store } = await openBinding(new MemoryDocumentCache(storage));
    addStickies(store, 4, { batchSize: 1 });
    await binding.flush();
    const { binding: second } = await openBinding(new MemoryDocumentCache(storage));
    await second.flush();
    expect(storage.board(BOARD).updates.size).toBe(4);
  });

  it('stores the reference repair the store makes while restoring a cached board', async () => {
    const storage = new MemoryCacheStorage();
    const { binding, store } = await openBinding(new MemoryDocumentCache(storage));
    // A board cached before: a sticky whose parent a concurrent delete removed.
    store.transact({ kind: 'user', principalId: 'user:ada' as never }, (transaction) => {
      transaction.setObject({ ...sticky('orphan', 1), parentId: 'gone' } as BoardObject);
    });
    await binding.flush();
    const cache = new MemoryDocumentCache(storage);
    const append = vi.spyOn(cache, 'append');
    const { binding: reopened, store: restored } = await openBinding(cache);
    await reopened.flush();
    expect(restored.get('orphan' as ObjectId)?.parentId).toBeNull();
    expect(append).toHaveBeenCalledTimes(1);
    expect(storage.board(BOARD).updates.size).toBe(2);
    // A later cold load finds the repair in the cache and has nothing left to repair.
    const later = new MemoryDocumentCache(storage);
    const laterAppend = vi.spyOn(later, 'append');
    const { binding: third, store: loaded } = await openBinding(later);
    await third.flush();
    expect(laterAppend).not.toHaveBeenCalled();
    expect(loaded.get('orphan' as ObjectId)).toEqual(restored.get('orphan' as ObjectId));
  });

  it('compacts the log into a snapshot every compactEvery updates', async () => {
    const storage = new MemoryCacheStorage();
    const { binding, store } = await openBinding(new MemoryDocumentCache(storage), undefined, 3);
    for (let index = 0; index < 7; index += 1) {
      store.transact({ kind: 'user', principalId: 'user:ada' as never }, (transaction) => {
        transaction.setObject(sticky(`note-${String(index)}`, index));
      });
      await binding.flush();
    }
    const board = storage.board(BOARD);
    expect(board.snapshot?.version).toBe(2);
    expect(board.updates.size).toBe(1);
    const { store: reopened } = await openBinding(new MemoryDocumentCache(storage));
    expect(reopened.read().objects.size).toBe(7);
  });

  it('counts restored updates towards the next compaction', async () => {
    const storage = new MemoryCacheStorage();
    const first = await openBinding(new MemoryDocumentCache(storage), undefined, 3);
    addStickies(first.store, 2, { batchSize: 1 });
    await first.binding.flush();
    const second = await openBinding(new MemoryDocumentCache(storage), undefined, 3);
    second.store.transact({ kind: 'user', principalId: 'user:ada' as never }, (transaction) => {
      transaction.setObject(sticky('extra', 99));
    });
    await second.binding.flush();
    expect(storage.board(BOARD).snapshot?.version).toBe(1);
    expect(storage.board(BOARD).updates.size).toBe(0);
  });

  it("absorbs another tab's newer snapshot into the store before it replaces it", async () => {
    const storage = new MemoryCacheStorage();
    const tabA = await openBinding(new MemoryDocumentCache(storage));
    const tabB = await openBinding(new MemoryDocumentCache(storage));
    addStickies(tabB.store, 2, { seed: 5 });
    await tabB.binding.compact();
    addStickies(tabA.store, 1, { seed: 6 });
    await tabA.binding.compact();
    await tabA.binding.flush();
    expect(tabA.store.read().objects.size).toBe(3);
    expect(storage.board(BOARD).snapshot?.version).toBe(2);
    expect(storage.board(BOARD).updates.size).toBe(0);
    const { store: reopened } = await openBinding(new MemoryDocumentCache(storage));
    expect(reopened.read().objects.size).toBe(3);
  });

  it('runs a due compaction only when the idle scheduler runs it, within the idle timeout', async () => {
    const storage = new MemoryCacheStorage();
    const time = new ManualTime();
    const store = new YjsDocumentStore();
    const binding = await DocumentCacheBinding.open({
      store,
      cache: new MemoryDocumentCache(storage),
      boardId: BOARD,
      compactEvery: 2,
      idleScheduler: time,
      idleTimeoutMs: 1_000,
    });
    addStickies(store, 2, { batchSize: 1 });
    await Promise.resolve();
    expect(storage.board(BOARD).snapshot).toBeUndefined();
    time.advanceBy(999);
    expect(storage.board(BOARD).snapshot).toBeUndefined();
    time.advanceBy(1);
    await binding.flush();
    expect(storage.board(BOARD).snapshot?.version).toBe(1);
    expect(storage.board(BOARD).updates.size).toBe(0);
  });

  it('drops a compaction still waiting for idle time when destroyed', async () => {
    const storage = new MemoryCacheStorage();
    const time = new ManualTime();
    const store = new YjsDocumentStore();
    const binding = await DocumentCacheBinding.open({
      store,
      cache: new MemoryDocumentCache(storage),
      boardId: BOARD,
      idleScheduler: time,
    });
    const compaction = binding.compact();
    binding.destroy();
    await compaction;
    time.advanceBy(60_000);
    expect(storage.board(BOARD).snapshot).toBeUndefined();
    expect(time.pendingTaskCount).toBe(0);
  });

  it('stops storing updates once destroyed', async () => {
    const storage = new MemoryCacheStorage();
    const { binding, store } = await openBinding(new MemoryDocumentCache(storage));
    binding.destroy();
    addStickies(store, 1);
    await binding.flush();
    expect(storage.board(BOARD).updates.size).toBe(0);
  });

  it('reports failed writes and compactions to onError', async () => {
    const cache = new MemoryDocumentCache();
    const onError = vi.fn();
    const store = new YjsDocumentStore();
    const binding = await DocumentCacheBinding.open({
      store,
      cache,
      boardId: BOARD,
      compactEvery: 1,
      onError,
    });
    cache.close();
    addStickies(store, 1);
    await binding.flush();
    await expect(binding.compact()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it('rethrows an unhandled failure asynchronously by default', async () => {
    const cache = new MemoryDocumentCache();
    const store = new YjsDocumentStore();
    const binding = await DocumentCacheBinding.open({ store, cache, boardId: BOARD });
    const thrown = vi.fn();
    const microtask = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      try {
        callback();
      } catch (error: unknown) {
        thrown(error);
      }
    });
    cache.close();
    addStickies(store, 1);
    await binding.flush();
    microtask.mockRestore();
    expect(thrown).toHaveBeenCalledOnce();
  });

  it('rejects compactEvery below 1', async () => {
    await expect(
      DocumentCacheBinding.open({
        store: new YjsDocumentStore(),
        cache: new MemoryDocumentCache(),
        boardId: BOARD,
        compactEvery: 0,
      }),
    ).rejects.toThrow(RangeError);
  });
});

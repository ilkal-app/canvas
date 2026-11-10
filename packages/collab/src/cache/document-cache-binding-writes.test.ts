// The binding's pending writes: each append is pending from the store's update until
// its IndexedDB transaction commits or aborts, so the shell can hold a reload meanwhile; and
// `holdNewWork` defers compactions while the page is being hidden. In Chrome:
// tooling/scenario/specs/app/reload-while-saving.spec.ts.
import { IDBDatabase, IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';

import { addStickies } from './__fixtures__/sticky-board.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { openIndexedDbCache } from './indexeddb-cache.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';

const BOARD = 'board-1';

/** Makes every IndexedDB transaction created from now on abort before it commits. */
function abortEveryTransaction(): void {
  const { transaction } = IDBDatabase.prototype as {
    transaction: (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) => IDBTransaction;
  };
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
    this: IDBDatabase,
    ...args: Parameters<IDBDatabase['transaction']>
  ) {
    const created = transaction.apply(this, args);
    queueMicrotask(() => {
      created.abort();
    });
    return created;
  });
}

describe('DocumentCacheBinding writes', () => {
  it('is pending from an edit until its IndexedDB transaction commits', async () => {
    const cache = await openIndexedDbCache({ factory: new IDBFactory() });
    const store = new YjsDocumentStore();
    const binding = await DocumentCacheBinding.open({ store, cache, boardId: BOARD });
    const seen: boolean[] = [];
    binding.writes.subscribe(() => seen.push(binding.writes.isPending));
    expect(binding.writes.isPending).toBe(false);
    addStickies(store, 1);
    expect(binding.writes.isPending).toBe(true);
    await binding.writes.settled();
    expect(binding.writes.isPending).toBe(false);
    expect(seen).toEqual([true, false]);
    expect((await cache.load(BOARD)).updates).toHaveLength(1);
    binding.destroy();
    cache.close();
  });

  it('stays pending over overlapping edits until the last transaction commits', async () => {
    const cache = await openIndexedDbCache({ factory: new IDBFactory() });
    const store = new YjsDocumentStore();
    const binding = await DocumentCacheBinding.open({ store, cache, boardId: BOARD });
    const listener = vi.fn();
    binding.writes.subscribe(listener);
    addStickies(store, 3, { batchSize: 1 });
    expect(binding.writes.isPending).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    await binding.writes.settled();
    expect(listener).toHaveBeenCalledTimes(2);
    expect((await cache.load(BOARD)).updates).toHaveLength(3);
    binding.destroy();
    cache.close();
  });

  it('settles a write whose transaction aborts, and reports it', async () => {
    const cache = await openIndexedDbCache({ factory: new IDBFactory() });
    const store = new YjsDocumentStore();
    const onError = vi.fn();
    const binding = await DocumentCacheBinding.open({ store, cache, boardId: BOARD, onError });
    abortEveryTransaction();
    addStickies(store, 1);
    expect(binding.writes.isPending).toBe(true);
    await binding.writes.settled();
    expect(binding.writes.isPending).toBe(false);
    await binding.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    binding.destroy();
    cache.close();
  });

  it('defers a due compaction while new work is held, and runs it once released', async () => {
    const storage = new MemoryCacheStorage();
    const store = new YjsDocumentStore();
    const cache = new MemoryDocumentCache(storage);
    const binding = await DocumentCacheBinding.open({
      store,
      cache,
      boardId: BOARD,
      compactEvery: 3,
    });
    const release = binding.writes.holdNewWork();
    addStickies(store, 4, { batchSize: 1 });
    await binding.flush();
    expect(storage.board(BOARD).snapshot).toBeUndefined();
    binding.resumeCompaction();
    await binding.flush();
    expect(storage.board(BOARD).snapshot).toBeUndefined();
    release();
    await binding.flush();
    expect(storage.board(BOARD).snapshot).toBeDefined();
    expect(storage.board(BOARD).updates.size).toBe(0);
    binding.destroy();
  });

  it('starts no compaction when a hold is released after the binding is destroyed', async () => {
    const storage = new MemoryCacheStorage();
    const store = new YjsDocumentStore();
    const cache = new MemoryDocumentCache(storage);
    const binding = await DocumentCacheBinding.open({
      store,
      cache,
      boardId: BOARD,
      compactEvery: 2,
    });
    const release = binding.writes.holdNewWork();
    addStickies(store, 3, { batchSize: 1 });
    await binding.flush();
    binding.destroy();
    release();
    await binding.flush();
    expect(storage.board(BOARD).snapshot).toBeUndefined();
  });
});

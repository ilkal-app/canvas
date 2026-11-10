import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { YjsDocumentStore } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { addStickies, sticky } from './__fixtures__/sticky-board.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';

const BOARD = 'restore-encoding';

/**
 * Stores a snapshot and one later update for the cold-open cases.
 *
 * @returns The shared cache records.
 */
async function seededCache(): Promise<MemoryCacheStorage> {
  const storage = new MemoryCacheStorage();
  const store = new YjsDocumentStore({ clientId: 1 });
  const binding = await DocumentCacheBinding.open({
    store,
    cache: new MemoryDocumentCache(storage),
    boardId: BOARD,
  });
  addStickies(store, 2, { seed: 1 });
  await binding.compact();
  addStickies(store, 1, { seed: 2 });
  await binding.flush();
  binding.destroy();
  store.destroy();
  return storage;
}

describe('cache restore update encoding', () => {
  it('applies cached snapshot and tail with no Yjs update event subscriber', async () => {
    const storage = await seededCache();
    const on = vi.spyOn(Y.Doc.prototype, 'on');
    const off = vi.spyOn(Y.Doc.prototype, 'off');
    const emit = vi.spyOn(Y.Doc.prototype, 'emit');
    let restoreApplications = 0;
    try {
      const store = new YjsDocumentStore({ clientId: 2 });
      const apply = store.applyUpdate.bind(store);
      vi.spyOn(store, 'applyUpdate').mockImplementation((update, origin, options) => {
        const firstEvent = emit.mock.calls.length;
        apply(update, origin, options);
        restoreApplications += 1;
        const transactionEvents = emit.mock.calls
          .slice(firstEvent)
          .map(([event], offset) => ({
            event,
            doc: emit.mock.contexts[firstEvent + offset],
            order: emit.mock.invocationCallOrder[firstEvent + offset] ?? 0,
          }))
          .filter(({ event }) => event === 'beforeTransaction' || event === 'afterTransaction')
          .slice(0, 2);
        expect(transactionEvents.map(({ event }) => event)).toEqual([
          'beforeTransaction',
          'afterTransaction',
        ]);
        for (const { doc, order } of transactionEvents) {
          const active = on.mock.calls.filter(
            ([event, handler], index) =>
              event === 'update' &&
              on.mock.contexts[index] === doc &&
              (on.mock.invocationCallOrder[index] ?? 0) < order &&
              !off.mock.calls.some(
                ([removedEvent, removedHandler], removedIndex) =>
                  removedEvent === 'update' &&
                  removedHandler === handler &&
                  off.mock.contexts[removedIndex] === doc &&
                  (off.mock.invocationCallOrder[removedIndex] ?? 0) >
                    (on.mock.invocationCallOrder[index] ?? 0) &&
                  (off.mock.invocationCallOrder[removedIndex] ?? 0) < order,
              ),
          ).length;
          expect(active).toBe(0);
        }
      });
      const binding = await DocumentCacheBinding.open({
        store,
        cache: new MemoryDocumentCache(storage),
        boardId: BOARD,
      });
      expect(restoreApplications).toBe(2);
      expect(store.read().objects.size).toBe(3);
      binding.destroy();
      store.destroy();
    } finally {
      emit.mockRestore();
      on.mockRestore();
      off.mockRestore();
    }
  });

  it('persists a reference repair caused by a silent cache restore', async () => {
    const storage = new MemoryCacheStorage();
    const source = new YjsDocumentStore({ clientId: 4 });
    const first = await DocumentCacheBinding.open({
      store: source,
      cache: new MemoryDocumentCache(storage),
      boardId: BOARD,
    });
    source.transact({ kind: 'user', principalId: 'user:ada' as never }, (transaction) => {
      transaction.setObject({ ...sticky('orphan', 1), parentId: 'gone' } as BoardObject);
    });
    await first.flush();
    first.destroy();
    source.destroy();

    const cache = new MemoryDocumentCache(storage);
    const append = vi.spyOn(cache, 'append');
    const restored = new YjsDocumentStore({ clientId: 5 });
    const binding = await DocumentCacheBinding.open({ store: restored, cache, boardId: BOARD });
    await binding.flush();

    expect(restored.get('orphan' as ObjectId)?.parentId).toBeNull();
    expect(append).toHaveBeenCalledTimes(1);
    expect(storage.board(BOARD).updates.size).toBe(2);
    binding.destroy();
    restored.destroy();
  });

  it('persists edits during cache load and after open without writing restored records again', async () => {
    const storage = await seededCache();
    const cache = new MemoryDocumentCache(storage);
    const append = vi.spyOn(cache, 'append');
    const load = cache.load.bind(cache);
    let releaseLoad: () => void = () => undefined;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    vi.spyOn(cache, 'load').mockImplementation(async (boardId) => {
      const cached = await load(boardId);
      await loadGate;
      return cached;
    });
    const store = new YjsDocumentStore({ clientId: 3 });
    const opening = DocumentCacheBinding.open({ store, cache, boardId: BOARD });
    addStickies(store, 1, { seed: 3 });
    releaseLoad();
    const binding = await opening;
    addStickies(store, 1, { seed: 4 });
    await binding.flush();

    expect(store.read().objects.size).toBe(5);
    expect(append).toHaveBeenCalledTimes(2);
    expect(storage.board(BOARD).snapshot?.version).toBe(1);
    expect(storage.board(BOARD).updates.size).toBe(3);
    binding.destroy();
    store.destroy();
  });
});

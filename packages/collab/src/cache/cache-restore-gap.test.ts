import { describe, expect, it } from 'vitest';

import { YjsDocumentStore, type TransactionOrigin } from '@canvas/document';
import type { ObjectId, PrincipalId } from '@canvas/schema';

import { ADA, sticky } from './__fixtures__/sticky-board.js';
import { DocumentCacheBinding } from './document-cache-binding.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';

const BOARD = 'restore-gap';
const PEER: TransactionOrigin = { kind: 'user', principalId: 'user:peer' as PrincipalId };

/**
 * One sticky written by its own client, as update bytes.
 *
 * @param id - The sticky's id.
 * @returns The update.
 */
function stickyUpdate(id: string): Uint8Array {
  const writer = new YjsDocumentStore();
  writer.transact(ADA, (transaction) => {
    transaction.setObject(sticky(id));
  });
  const bytes = writer.encodeState();
  writer.destroy();
  return bytes;
}

describe('DocumentCacheBinding restore in steps', () => {
  it('stores a remote update applied between the snapshot and its tail', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new MemoryDocumentCache(storage);
    await cache.compact(BOARD, stickyUpdate('snapshot'));
    await cache.append(BOARD, stickyUpdate('tail'));
    const store = new YjsDocumentStore();
    let isPeerApplied = false;
    const binding = await DocumentCacheBinding.open({
      store,
      cache,
      boardId: BOARD,
      yieldToBrowser: () => {
        // The first moment the store takes an update after the snapshot is in: the gap.
        if (!isPeerApplied && store.get('snapshot' as ObjectId) !== undefined) {
          try {
            store.applyUpdate(stickyUpdate('peer'), PEER);
            isPeerApplied = true;
          } catch {
            // Still inside the snapshot's own apply, which refuses other updates.
          }
        }
        return Promise.resolve();
      },
    });
    await binding.flush();
    binding.destroy();
    expect(isPeerApplied).toBe(true);
    const reopened = new YjsDocumentStore();
    const again = await DocumentCacheBinding.open({
      store: reopened,
      cache: new MemoryDocumentCache(storage),
      boardId: BOARD,
    });
    expect([...reopened.read().objects.keys()].sort()).toEqual(['peer', 'snapshot', 'tail']);
    again.destroy();
    reopened.destroy();
    store.destroy();
  });

  it('defers a compaction a gap update calls for until the tail is restored', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new MemoryDocumentCache(storage);
    await cache.compact(BOARD, stickyUpdate('snapshot'));
    await cache.append(BOARD, stickyUpdate('tail'));
    const store = new YjsDocumentStore();
    const idle: (() => void)[] = [];
    const runIdle = async (): Promise<void> => {
      for (const callback of idle.splice(0)) callback();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    let isPeerApplied = false;
    const binding = await DocumentCacheBinding.open({
      store,
      cache,
      boardId: BOARD,
      compactEvery: 1,
      idleScheduler: {
        schedule: (callback) => {
          idle.push(callback);
          return { cancel: () => undefined };
        },
      },
      yieldToBrowser: async () => {
        if (!isPeerApplied && store.get('snapshot' as ObjectId) !== undefined) {
          try {
            store.applyUpdate(stickyUpdate('peer'), PEER);
            isPeerApplied = true;
            // The compaction the peer's update calls for runs before the tail is applied.
            await runIdle();
          } catch {
            // Still inside the snapshot's own apply.
          }
        }
      },
    });
    await runIdle();
    await binding.flush();
    binding.destroy();
    expect(isPeerApplied).toBe(true);
    const reopened = new YjsDocumentStore();
    const again = await DocumentCacheBinding.open({
      store: reopened,
      cache: new MemoryDocumentCache(storage),
      boardId: BOARD,
    });
    expect([...reopened.read().objects.keys()].sort()).toEqual(['peer', 'snapshot', 'tail']);
    again.destroy();
    reopened.destroy();
    store.destroy();
  });
});

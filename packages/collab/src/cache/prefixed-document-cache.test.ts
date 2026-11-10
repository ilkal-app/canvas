import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import { describeDocumentCacheContract } from './__fixtures__/document-cache-contract.js';
import type { DocumentCache, EarlierLayoutBoard } from './document-cache.js';
import { openIndexedDbCache } from './indexeddb-cache.js';
import { MemoryCacheStorage, MemoryDocumentCache } from './memory-document-cache.js';
import { prefixDocumentCache } from './prefixed-document-cache.js';
import { snapshotDigest } from './snapshot-stamp.js';

const ALAN = 'user:alan/board:';

describeDocumentCacheContract('prefixDocumentCache over MemoryDocumentCache', () => {
  const storage = new MemoryCacheStorage();
  return Promise.resolve([
    prefixDocumentCache(new MemoryDocumentCache(storage), ALAN),
    prefixDocumentCache(new MemoryDocumentCache(storage), ALAN),
  ]);
});

describeDocumentCacheContract('prefixDocumentCache over IndexedDbDocumentCache', async () => {
  const factory = new IDBFactory();
  return [
    prefixDocumentCache(await openIndexedDbCache({ factory, databaseName: 'prefixed' }), ALAN),
    prefixDocumentCache(await openIndexedDbCache({ factory, databaseName: 'prefixed' }), ALAN),
  ];
});

/**
 * Every member a cache offers: its own and its prototype chain's, but the constructor.
 *
 * @param cache - The cache.
 * @returns The names, sorted.
 */
function membersOf(cache: DocumentCache): string[] {
  const names = new Set<string>(Object.keys(cache));
  for (
    let prototype: unknown = Object.getPrototypeOf(cache);
    prototype !== null && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    for (const name of Object.getOwnPropertyNames(prototype)) names.add(name);
  }
  names.delete('constructor');
  return [...names].sort();
}

describe('prefixDocumentCache', () => {
  it('offers every capability the cache it wraps offers, optional ones included', async () => {
    const indexedDb = await openIndexedDbCache({ factory: new IDBFactory() });
    for (const cache of [indexedDb, new MemoryDocumentCache()]) {
      expect(membersOf(prefixDocumentCache(cache, ALAN))).toEqual(membersOf(cache));
    }
    indexedDb.close();
  });

  it('keeps each prefix’s boards apart in one storage', async () => {
    const storage = new MemoryCacheStorage();
    const alan = prefixDocumentCache(new MemoryDocumentCache(storage), ALAN);
    const grace = prefixDocumentCache(new MemoryDocumentCache(storage), 'user:grace/board:');
    await alan.append('board-1', new Uint8Array([1]));
    expect(await grace.load('board-1')).toEqual({ snapshot: undefined, updates: [] });
    expect(await grace.readUpdates?.('board-1')).toEqual([]);
    expect(await alan.readUpdates?.('board-1')).toEqual([new Uint8Array([1])]);
    expect(storage.board(`${ALAN}board-1`).updates.size).toBe(1);
    expect(storage.board('user:grace/board:board-1').updates.size).toBe(0);
  });

  it('keeps snapshot previews under the same owner prefix as their snapshots', async () => {
    const indexedDb = await openIndexedDbCache({ factory: new IDBFactory() });
    for (const cache of [indexedDb, new MemoryDocumentCache()]) {
      const alan = prefixDocumentCache(cache, ALAN);
      const grace = prefixDocumentCache(cache, 'user:grace/board:');
      await alan.load('board-1');
      const snapshot = new Uint8Array([1]);
      const preview = new Uint8Array([2]);
      expect(await alan.snapshotPreview?.compact('board-1', snapshot, preview)).toBe(true);
      expect((await alan.snapshotPreview?.read('board-1'))?.bytes).toEqual(preview);
      expect(await grace.snapshotPreview?.read('board-1')).toBeUndefined();
      expect(await cache.snapshotPreview?.read('board-1')).toBeUndefined();
      expect((await cache.load(`${ALAN}board-1`)).snapshot).toEqual(snapshot);
    }
    indexedDb.close();
  });

  it('carries a snapshot stamp through both compactions to the prefixed reopen', async () => {
    const indexedDb = await openIndexedDbCache({ factory: new IDBFactory() });
    for (const cache of [indexedDb, new MemoryDocumentCache()]) {
      const alan = prefixDocumentCache(cache, ALAN);
      const snapshot = new Uint8Array([1]);
      const stamp = { digest: snapshotDigest(snapshot), layoutVersion: 1, schemaVersion: 1 };
      await alan.load('board-1');
      expect(await alan.compact('board-1', snapshot, stamp)).toBe(true);
      expect((await alan.load('board-1')).snapshotStamp).toEqual(stamp);
      await alan.load('board-2');
      const preview = new Uint8Array([2]);
      expect(await alan.snapshotPreview?.compact('board-2', snapshot, preview, stamp)).toBe(true);
      expect((await alan.load('board-2')).snapshotStamp).toEqual(stamp);
    }
    indexedDb.close();
  });

  it('reads and deletes earlier layouts’ copies under the prefixed key', async () => {
    const copy: EarlierLayoutBoard = {
      source: 'old-database',
      layoutVersion: 6,
      board: { snapshot: undefined, updates: [] },
      updateKeys: [1],
      snapshotVersion: undefined,
      isPreLayoutCache: false,
    };
    const find = vi.fn(() => Promise.resolve([copy]));
    const remove = vi.fn(() => Promise.resolve());
    const cache = Object.assign(new MemoryDocumentCache(), {
      earlierLayouts: { writerLayoutVersion: 7, find, delete: remove },
    });
    const earlier = prefixDocumentCache(cache, ALAN).earlierLayouts;
    expect(earlier?.writerLayoutVersion).toBe(7);
    expect(await earlier?.find('board-1')).toEqual([copy]);
    expect(find).toHaveBeenCalledExactlyOnceWith(`${ALAN}board-1`);
    await earlier?.delete('board-1', copy);
    expect(remove).toHaveBeenCalledExactlyOnceWith(`${ALAN}board-1`, copy);
  });
});

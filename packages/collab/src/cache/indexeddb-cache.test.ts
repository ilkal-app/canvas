import { IDBDatabase, IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import { DOCUMENT_LAYOUT_VERSION } from '@canvas/document';

import { describeDocumentCacheContract } from './__fixtures__/document-cache-contract.js';
import { openIndexedDbCache } from './indexeddb-cache.js';

describeDocumentCacheContract('IndexedDbDocumentCache', async () => {
  const factory = new IDBFactory();
  return [
    await openIndexedDbCache({ factory, databaseName: 'contract' }),
    await openIndexedDbCache({ factory, databaseName: 'contract' }),
  ];
});

describe('openIndexedDbCache', () => {
  it('keeps boards across connections to the same database', async () => {
    const factory = new IDBFactory();
    const first = await openIndexedDbCache({ factory });
    await first.append('board-1', new Uint8Array([1]));
    first.close();
    const second = await openIndexedDbCache({ factory });
    expect(await second.load('board-1')).toEqual({
      snapshot: undefined,
      updates: [new Uint8Array([1])],
    });
  });

  it("uses the platform's IndexedDB by default", async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const cache = await openIndexedDbCache();
    await cache.append('board-1', new Uint8Array([1]));
    expect((await cache.load('board-1')).updates).toHaveLength(1);
    cache.close();
    vi.unstubAllGlobals();
  });

  it('rejects a request whose transaction aborts', async () => {
    const cache = await openIndexedDbCache({ factory: new IDBFactory() });
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
    await expect(cache.append('board-1', new Uint8Array([1]))).rejects.toThrow();
  });

  it('rejects when the database exists at a newer version', async () => {
    const factory = new IDBFactory();
    const newer = factory.open(`versioned:layout:${String(DOCUMENT_LAYOUT_VERSION)}:recovery:1`, 5);
    await new Promise((resolve) => {
      newer.onsuccess = resolve;
    });
    newer.result.close();
    await expect(openIndexedDbCache({ factory, databaseName: 'versioned' })).rejects.toThrow();
  });

  it('closes itself when another connection upgrades the database', async () => {
    const factory = new IDBFactory();
    const cache = await openIndexedDbCache({ factory, databaseName: 'upgraded' });
    const upgrade = factory.open(
      `upgraded:layout:${String(DOCUMENT_LAYOUT_VERSION)}:recovery:1`,
      3,
    );
    await new Promise((resolve) => {
      upgrade.onsuccess = resolve;
    });
    await expect(cache.load('board-1')).rejects.toThrow();
  });
});

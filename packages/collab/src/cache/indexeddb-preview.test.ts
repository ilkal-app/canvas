import { IDBDatabase, IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import { openIndexedDbCache } from './indexeddb-cache.js';

const bytes = (...values: number[]) => new Uint8Array(values);

function previews(cache: Awaited<ReturnType<typeof openIndexedDbCache>>) {
  if (cache.snapshotPreview === undefined) throw new Error('Missing preview capability');
  return cache.snapshotPreview;
}

describe('IndexedDB preview isolation and atomicity', () => {
  it('reads only the current layout without opening or carrying earlier databases', async () => {
    const factory = new IDBFactory();
    const earlier = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    const current = await openIndexedDbCache({ factory, writerLayoutVersion: 3 });
    await previews(earlier).compact('board', bytes(1), bytes(8));
    const open = vi.spyOn(factory, 'open');
    const find = vi.spyOn(current.earlierLayouts, 'find');
    expect(await previews(current).read('board')).toBeUndefined();
    await previews(current).compact('board', bytes(2), bytes(9));
    expect(await previews(current).read('board')).toEqual({
      snapshotVersion: 1,
      bytes: bytes(9),
    });
    expect(open).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(await previews(earlier).read('board')).toEqual({
      snapshotVersion: 1,
      bytes: bytes(8),
    });
    earlier.close();
    current.close();
  });

  it('keeps the previous snapshot and preview together when a transaction aborts', async () => {
    const factory = new IDBFactory();
    const writer = await openIndexedDbCache({ factory });
    const reader = await openIndexedDbCache({ factory });
    await previews(writer).compact('board', bytes(1), bytes(8));
    const intercepted = vi
      .spyOn(IDBDatabase.prototype, 'transaction')
      .mockImplementationOnce(function (
        this: IDBDatabase,
        ...args: Parameters<IDBDatabase['transaction']>
      ) {
        intercepted.mockRestore();
        const created = this.transaction(...args);
        queueMicrotask(() => {
          created.abort();
        });
        return created;
      });
    await expect(previews(writer).compact('board', bytes(2), bytes(9))).rejects.toThrow();
    intercepted.mockRestore();
    expect(await reader.load('board')).toEqual({ snapshot: bytes(1), updates: [] });
    expect(await previews(reader).read('board')).toEqual({
      snapshotVersion: 1,
      bytes: bytes(8),
    });
    writer.close();
    reader.close();
  });
});

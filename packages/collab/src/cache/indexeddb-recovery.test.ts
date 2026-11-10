import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';

import { DOCUMENT_LAYOUT_VERSION } from '@canvas/document';

import { openIndexedDbCache } from './indexeddb-cache.js';
import { SNAPSHOTS, UPDATES, UPDATES_BY_BOARD } from './indexeddb-records.js';
import * as recoveryRecords from './indexeddb-recovery.js';
import { openExistingDatabase } from './legacy-cache-copy.js';

const bytes = (...values: number[]) => new Uint8Array(values);
afterEach(() => {
  vi.restoreAllMocks();
});

it('keeps an older writer open and discovers its later offline edits after recovery', async () => {
  const factory = new IDBFactory();
  const name = `fence:layout:${String(DOCUMENT_LAYOUT_VERSION)}`;
  const request = factory.open(name, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    database.createObjectStore(SNAPSHOTS, { keyPath: 'boardId' });
    database
      .createObjectStore(UPDATES, { keyPath: 'seq', autoIncrement: true })
      .createIndex(UPDATES_BY_BOARD, 'boardId');
  };
  const old = await new Promise<IDBDatabase>((resolve) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
  const transaction = old.transaction([SNAPSHOTS, UPDATES], 'readwrite');
  transaction.objectStore(SNAPSHOTS).put({ boardId: 'b', version: 7, bytes: bytes(1) });
  transaction.objectStore(UPDATES).add({ boardId: 'b', bytes: bytes(2) });
  await new Promise<void>((resolve) => {
    transaction.oncomplete = () => {
      resolve();
    };
  });
  const close = vi.fn(() => {
    old.close();
  });
  old.onversionchange = close;
  const upgraded = await openIndexedDbCache({ factory, databaseName: 'fence' });
  expect(close).not.toHaveBeenCalled();
  expect(await upgraded.load('b')).toEqual({ snapshot: bytes(1), updates: [bytes(2)] });
  const recovery = upgraded.recovery;
  if (recovery === undefined) throw new Error('Missing recovery capability.');
  expect(await recovery.publish('b', await recovery.capture('b'), bytes(8))).toBe(true);
  expect((await recovery.retained('b'))[0]?.board).toEqual({
    snapshot: bytes(1),
    updates: [bytes(2)],
  });
  const late = old.transaction(UPDATES, 'readwrite');
  late.objectStore(UPDATES).add({ boardId: 'b', bytes: bytes(3) });
  await new Promise<void>((resolve, reject) => {
    late.oncomplete = () => {
      resolve();
    };
    late.onabort = () => {
      reject(late.error ?? new Error('Late write aborted.'));
    };
  });
  const reopened = await openIndexedDbCache({ factory, databaseName: 'fence' });
  const sources = await reopened.recovery?.retained('b');
  expect(sources?.some(({ board }) => board.updates.some((update) => update[0] === 3))).toBe(true);
  expect(old.version).toBe(1);
  old.close();
  reopened.close();
  upgraded.close();
});

it('an aborted publication leaves the original generation and connection binding intact', async () => {
  const factory = new IDBFactory();
  const cache = await openIndexedDbCache({ factory });
  await cache.append('b', bytes(1));
  const recovery = cache.recovery;
  if (recovery === undefined) throw new Error('Missing recovery capability.');
  const captured = await recovery.capture('b');
  const { put } = IDBObjectStore.prototype as {
    put: (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) => IDBRequest<IDBValidKey>;
  };
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore['put']>
  ) {
    const result = put.apply(this, args);
    this.transaction.abort();
    return result;
  });
  await expect(recovery.publish('b', captured, bytes(8))).rejects.toThrow();
  vi.restoreAllMocks();
  await cache.append('b', bytes(2));
  const fresh = await openIndexedDbCache({ factory });
  expect(await fresh.load('b')).toEqual({ snapshot: undefined, updates: [bytes(1), bytes(2)] });
  expect(await fresh.recovery?.retained('b')).toEqual([]);
  expect(await recovery.publish('b', await recovery.capture('b'), bytes(9))).toBe(true);
  expect(await (await openIndexedDbCache({ factory })).load('b')).toEqual({
    snapshot: bytes(9),
    updates: [],
  });
});

it('earlier-layout discovery includes retained snapshot bytes and cannot retire recovery sources', async () => {
  const factory = new IDBFactory();
  const old = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
  await old.append('b', bytes(1));
  await old.compact('b', bytes(1));
  await old.append('b', bytes(2));
  const recovery = old.recovery;
  if (recovery === undefined) throw new Error('Missing recovery capability.');
  await recovery.publish('b', await recovery.capture('b'), bytes(8));
  const later = await openIndexedDbCache({ factory, writerLayoutVersion: 3 });
  const copies = await later.earlierLayouts.find('b');
  const copy = copies[0];
  if (copy === undefined) throw new Error('Missing earlier layout copy.');
  expect(copy.board).toEqual({ snapshot: bytes(8), updates: [bytes(1), bytes(2)] });
  await later.earlierLayouts.delete('b', copy);
  expect(await recovery.retained('b')).toEqual([
    expect.objectContaining({ board: { snapshot: bytes(1), updates: [bytes(2)] } }),
  ]);
  expect(await later.earlierLayouts.find('b')).toEqual(copies);
});

it.each([new Error('read result failed'), 'non-Error read failure'])(
  'rejects a read-result failure without losing bytes or poisoning later requests (%s)',
  async (failure) => {
    const cache = await openIndexedDbCache({ factory: new IDBFactory() });
    await cache.append('b', bytes(7));
    const capture = vi.spyOn(recoveryRecords, 'captureGeneration').mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise normalization of an invalid read failure.
      throw failure;
    });
    await expect(cache.load('b')).rejects.toBeInstanceOf(Error);
    capture.mockRestore();
    expect(await cache.load('b')).toEqual({ snapshot: undefined, updates: [bytes(7)] });
    cache.close();
  },
);

it('refuses an inspection that would upgrade an existing database, preserving its version', async () => {
  const factory = new IDBFactory();
  const create = factory.open('inspect-only', 1);
  const database = await new Promise<IDBDatabase>((resolve) => {
    create.onsuccess = () => {
      resolve(create.result);
    };
  });
  database.close();
  await expect(openExistingDatabase(factory, 'inspect-only', 2)).rejects.toThrow();
  const unchanged = await openExistingDatabase(factory, 'inspect-only', 1);
  expect(unchanged?.version).toBe(1);
  unchanged?.close();
});

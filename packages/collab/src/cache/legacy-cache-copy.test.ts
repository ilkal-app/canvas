import { IDBDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { MAX_UPDATE_VALUE_DEPTH, UpdateDepthError } from '@canvas/document';

import { openIndexedDbCache } from './indexeddb-cache.js';
import { classifyLegacyBoard, readLegacyRecords } from './legacy-cache-copy.js';

interface LegacyBoard {
  readonly boardId: string;
  readonly snapshot?: Uint8Array;
  readonly updates: readonly Uint8Array[];
}

async function seed(factory: IDBFactory, boards: readonly LegacyBoard[]): Promise<void> {
  const request = factory.open('copy-test', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('snapshots', { keyPath: 'boardId' });
    request.result
      .createObjectStore('updates', { keyPath: 'seq', autoIncrement: true })
      .createIndex('by-board', 'boardId');
  };
  const database = await new Promise<IDBDatabase>((resolve) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
  const transaction = database.transaction(['snapshots', 'updates'], 'readwrite');
  for (const board of boards) {
    if (board.snapshot !== undefined)
      transaction.objectStore('snapshots').put({
        boardId: board.boardId,
        version: 7,
        bytes: board.snapshot,
      });
    for (const bytes of board.updates)
      transaction.objectStore('updates').add({ boardId: board.boardId, bytes });
  }
  await new Promise<void>((resolve) => {
    transaction.oncomplete = () => {
      resolve();
    };
  });
  database.close();
}

function board(layout?: number, hasOldStamp = false): Uint8Array {
  const doc = new Y.Doc({ gc: false });
  if (hasOldStamp) doc.getMap('meta').set('document', { schemaVersion: 1, layoutVersion: 1 });
  if (layout !== undefined)
    doc.getMap('meta').set('document', { schemaVersion: 1, layoutVersion: layout });
  doc.getMap('offline').set('note', 'keep');
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return bytes;
}

it('copies layout2 and unstamped offline boards once, retaining pending fragments byte-for-byte', async () => {
  const factory = new IDBFactory();
  const writer = new Y.Doc();
  writer.getMap('offline').set('first', 'missing dependency');
  const vector = Y.encodeStateVector(writer);
  writer.getMap('offline').set('second', 'pending edit');
  const pending = Y.encodeStateAsUpdate(writer, vector);
  writer.destroy();
  const snapshot = board(2);
  const unstamped = board();
  await seed(factory, [
    { boardId: 'current', snapshot, updates: [pending] },
    { boardId: 'local', updates: [unstamped] },
  ]);
  const before = await rawRecords(factory);
  const options = { factory, databaseName: 'copy-test', writerLayoutVersion: 2 };
  const cache = await openIndexedDbCache(options);
  expect(await cache.load('current')).toEqual({ snapshot, updates: [pending] });
  expect(await cache.load('local')).toEqual({ snapshot: undefined, updates: [unstamped] });
  await cache.delete('current');
  cache.close();
  const reopened = await openIndexedDbCache(options);
  expect((await reopened.load('current')).updates).toEqual([]);
  expect((await reopened.load('current')).snapshot).toBeUndefined();
  reopened.close();
  expect(await rawRecords(factory)).toEqual(before);
});

it('skips positive layout1 evidence, including a retained superseded stamp', async () => {
  const factory = new IDBFactory();
  await seed(factory, [
    { boardId: 'old', snapshot: board(1), updates: [] },
    { boardId: 'superseded', snapshot: board(2, true), updates: [] },
  ]);
  const cache = await openIndexedDbCache({
    factory,
    databaseName: 'copy-test',
    writerLayoutVersion: 2,
  });
  for (const name of ['old', 'superseded']) {
    expect(await cache.load(name)).toEqual({ snapshot: undefined, updates: [] });
  }
  cache.close();
});

it('copies atomically for concurrent opens, without duplicating update records', async () => {
  const factory = new IDBFactory();
  const bytes = board(2);
  await seed(factory, [{ boardId: 'board', updates: [bytes] }]);
  const [first, second] = await Promise.all([
    openIndexedDbCache({ factory, databaseName: 'copy-test', writerLayoutVersion: 2 }),
    openIndexedDbCache({ factory, databaseName: 'copy-test', writerLayoutVersion: 2 }),
  ]);
  expect((await first.load('board')).updates).toEqual([bytes]);
  await second.append('board', board());
  expect((await first.load('board')).updates).toHaveLength(2);
  first.close();
  second.close();
});

it('skips and reports a legacy board it cannot read, copying the others', async () => {
  const factory = new IDBFactory();
  const readable = board(2);
  await seed(factory, [
    { boardId: 'broken', updates: [new Uint8Array([255])] },
    { boardId: 'fine', updates: [readable] },
  ]);
  const before = await rawRecords(factory);
  const onError = vi.fn();
  const cache = await openIndexedDbCache({
    factory,
    databaseName: 'copy-test',
    writerLayoutVersion: 2,
    onError,
  });
  expect(onError).toHaveBeenCalledTimes(1);
  expect(String(onError.mock.calls[0]?.[0])).toContain('board broken could not be read');
  expect(await cache.load('broken')).toEqual({ snapshot: undefined, updates: [] });
  expect(await cache.load('fine')).toEqual({ snapshot: undefined, updates: [readable] });
  cache.close();
  expect(await rawRecords(factory)).toEqual(before);
});

it('does not create an absent legacy database while opening a fresh cache', async () => {
  const factory = new IDBFactory();
  const cache = await openIndexedDbCache({
    factory,
    databaseName: 'copy-test',
    writerLayoutVersion: 2,
  });
  cache.close();
  expect((await factory.databases()).map(({ name }) => name)).toEqual([
    'copy-test:layout:2:recovery:1',
  ]);
});

async function rawRecords(factory: IDBFactory): Promise<unknown> {
  const request = factory.open('copy-test');
  const database = await new Promise<IDBDatabase>((resolve) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
  const transaction = database.transaction(['snapshots', 'updates'], 'readonly');
  const snapshots = transaction.objectStore('snapshots').getAll();
  const updates = transaction.objectStore('updates').getAll();
  await new Promise<void>((resolve) => {
    transaction.oncomplete = () => {
      resolve();
    };
  });
  database.close();
  return { snapshots: snapshots.result, updates: updates.result };
}

it('rolls back a failed copy and permits a complete retry', async () => {
  const factory = new IDBFactory();
  const snapshot = board(2);
  const update = board();
  await seed(factory, [{ boardId: 'board', snapshot, updates: [update] }]);
  const before = await rawRecords(factory);
  const { add: original } = IDBObjectStore.prototype as {
    add: (this: IDBObjectStore, value: unknown, key?: IDBValidKey) => IDBRequest<IDBValidKey>;
  };
  const abortCopy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
    this: IDBObjectStore,
    ...args
  ) {
    const request = original.apply(this, args);
    if (this.transaction.mode === 'versionchange') this.transaction.abort();
    return request;
  });
  try {
    await expect(
      openIndexedDbCache({ factory, databaseName: 'copy-test', writerLayoutVersion: 2 }),
    ).rejects.toThrow();
  } finally {
    abortCopy.mockRestore();
  }
  expect((await factory.databases()).map(({ name }) => name)).toEqual(['copy-test']);
  expect(await rawRecords(factory)).toEqual(before);
  const cache = await openIndexedDbCache({
    factory,
    databaseName: 'copy-test',
    writerLayoutVersion: 2,
  });
  expect(await cache.load('board')).toEqual({ snapshot, updates: [update] });
  cache.close();
});

it('does not import an unsuffixed predecessor for layout 1, or past a layout-2 cache', async () => {
  const factory = new IDBFactory();
  await seed(factory, [{ boardId: 'board', updates: [board(2)] }]);
  expect(await readLegacyRecords(factory, 'copy-test', 1)).toBeUndefined();
  expect(await readLegacyRecords(factory, 'copy-test', 3)).toBeDefined();
  (
    await openIndexedDbCache({ factory, databaseName: 'copy-test', writerLayoutVersion: 2 })
  ).close();
  expect(await readLegacyRecords(factory, 'copy-test', 3)).toBeUndefined();
});

it('reports an aborted legacy read without creating a destination or changing legacy data', async () => {
  const factory = new IDBFactory();
  await seed(factory, [{ boardId: 'board', updates: [board(2)] }]);
  const before = await rawRecords(factory);
  const { transaction: original } = IDBDatabase.prototype as {
    transaction: (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) => IDBTransaction;
  };
  const failedRead = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
    this: IDBDatabase,
    ...args
  ) {
    const transaction = original.apply(this, args);
    if (transaction.mode === 'readonly')
      queueMicrotask(() => {
        transaction.abort();
      });
    return transaction;
  });
  try {
    await expect(
      openIndexedDbCache({ factory, databaseName: 'copy-test', writerLayoutVersion: 2 }),
    ).rejects.toThrow('Legacy offline cache could not be inspected');
  } finally {
    failedRead.mockRestore();
  }
  expect((await factory.databases()).map(({ name }) => name)).toEqual(['copy-test']);
  expect(await rawRecords(factory)).toEqual(before);
});

it.each(['snapshot', 'update'])(
  'scans a legacy %s before replay and keeps original records',
  async (location) => {
    const document = new Y.Doc();
    let value: unknown = null;
    for (let depth = 0; depth <= MAX_UPDATE_VALUE_DEPTH; depth += 1) value = [value];
    document.getMap('offline').set('nested', value);
    const bytes = Y.encodeStateAsUpdate(document);
    document.destroy();
    const verdict = classifyLegacyBoard([bytes]);
    expect(verdict.kind).toBe('unreadable');
    if (verdict.kind !== 'unreadable') throw new Error('expected a refused depth scan');
    expect(verdict.error).toBeInstanceOf(UpdateDepthError);
    const factory = new IDBFactory();
    const readable = board(2);
    await seed(factory, [
      {
        boardId: 'deep',
        ...(location === 'snapshot' ? { snapshot: bytes } : {}),
        updates: location === 'update' ? [bytes] : [],
      },
      { boardId: 'fine', updates: [readable] },
    ]);
    const before = await rawRecords(factory);
    const onError = vi.fn();
    const cache = await openIndexedDbCache({
      factory,
      databaseName: 'copy-test',
      writerLayoutVersion: 2,
      onError,
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(await cache.load('deep')).toEqual({ snapshot: undefined, updates: [] });
    expect(await cache.load('fine')).toEqual({ snapshot: undefined, updates: [readable] });
    cache.close();
    expect(await rawRecords(factory)).toEqual(before);
  },
);

it('copies the legacy cache into a layout-3 cache when no layout-2 cache exists', async () => {
  const factory = new IDBFactory();
  const bytes = board(2);
  await seed(factory, [{ boardId: 'board', updates: [bytes] }]);
  const before = await rawRecords(factory);
  const cache = await openIndexedDbCache({
    factory,
    databaseName: 'copy-test',
    writerLayoutVersion: 3,
  });
  expect(await cache.load('board')).toEqual({ snapshot: undefined, updates: [bytes] });
  cache.close();
  expect(await rawRecords(factory)).toEqual(before);
});

it('leaves the legacy cache to the layout-2 cache that already copied it', async () => {
  const factory = new IDBFactory();
  const bytes = board(2);
  await seed(factory, [{ boardId: 'board', updates: [bytes] }]);
  const layoutTwo = await openIndexedDbCache({
    factory,
    databaseName: 'copy-test',
    writerLayoutVersion: 2,
  });
  expect((await layoutTwo.load('board')).updates).toEqual([bytes]);
  layoutTwo.close();
  const cache = await openIndexedDbCache({
    factory,
    databaseName: 'copy-test',
    writerLayoutVersion: 3,
  });
  expect(await cache.load('board')).toEqual({ snapshot: undefined, updates: [] });
  cache.close();
});

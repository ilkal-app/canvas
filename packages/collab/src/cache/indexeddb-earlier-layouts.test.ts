import { IDBDatabase, IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { DOCUMENT_LAYOUT_VERSION } from '@canvas/document';

import type { EarlierLayoutBoard } from './document-cache.js';
import { openIndexedDbCache } from './indexeddb-cache.js';

/**
 * Writes one update for each board into the cache a build writing `layout` opens.
 *
 * @param factory - The IndexedDB factory.
 * @param layout - The writer layout of that build.
 * @param boards - The boards and the byte each gets.
 */
async function cacheAt(
  factory: IDBFactory,
  layout: number,
  boards: Readonly<Record<string, number>>,
): Promise<void> {
  const cache = await openIndexedDbCache({ factory, writerLayoutVersion: layout });
  for (const [boardId, byte] of Object.entries(boards)) {
    await cache.append(boardId, new Uint8Array([byte]));
  }
  cache.close();
}

/**
 * The names of the databases the factory holds.
 *
 * @param factory - The IndexedDB factory.
 * @returns The names, sorted.
 */
async function databaseNames(factory: IDBFactory): Promise<string[]> {
  return (await factory.databases()).map(({ name }) => name ?? '').sort();
}

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * What a test compares of the copies `find` returns: where they are and what they hold.
 *
 * @param copies - The copies.
 * @returns Their source, layout and board.
 */
function summary(copies: readonly EarlierLayoutBoard[]): unknown[] {
  return copies.map(({ source, layoutVersion, board, isPreLayoutCache }) => ({
    source,
    layoutVersion,
    board,
    isPreLayoutCache,
  }));
}

/**
 * One update copy in a layout's database.
 *
 * @param layout - The layout.
 * @param bytes - The update's bytes.
 * @returns What `summary` shows for it.
 */
function updateIn(layout: number, ...bytes: number[]): unknown {
  return {
    source: `canvas-board-cache:layout:${String(layout)}:recovery:1`,
    layoutVersion: layout,
    board: { snapshot: undefined, updates: bytes.map((byte) => new Uint8Array([byte])) },
    isPreLayoutCache: false,
  };
}

/**
 * Writes boards into the unsuffixed pre- database, with the cache's schema.
 *
 * @param factory - The IndexedDB factory.
 * @param boards - Each board's update records.
 */
async function seedUnsuffixed(
  factory: IDBFactory,
  boards: Readonly<Record<string, readonly Uint8Array[]>>,
): Promise<void> {
  const request = factory.open('canvas-board-cache', 1);
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
  const transaction = database.transaction('updates', 'readwrite');
  for (const [boardId, updates] of Object.entries(boards)) {
    for (const bytes of updates) transaction.objectStore('updates').add({ boardId, bytes });
  }
  await new Promise<void>((resolve) => {
    transaction.oncomplete = () => {
      resolve();
    };
  });
  database.close();
}

/**
 * A board's bytes, stamped with a layout or not.
 *
 * @param layout - The stamp's layout, if any.
 * @returns One update.
 */
function stampedBoard(layout?: number): Uint8Array {
  const doc = new Y.Doc();
  if (layout !== undefined) {
    doc.getMap('meta').set('document', { schemaVersion: 1, layoutVersion: layout });
  }
  doc.getMap('offline').set('note', 'kept');
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return bytes;
}

describe('earlierLayouts of the IndexedDB cache', () => {
  it('finds nothing, and creates no database, when no earlier layout cached anything', async () => {
    const factory = new IDBFactory();
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 4 });
    expect(cache.earlierLayouts.writerLayoutVersion).toBe(4);
    expect(await cache.earlierLayouts.find('board')).toEqual([]);
    expect(await databaseNames(factory)).toEqual(['canvas-board-cache:layout:4:recovery:1']);
    cache.close();
  });

  it('finds a board in every earlier layout that holds it, oldest first, with its keys', async () => {
    const factory = new IDBFactory();
    await cacheAt(factory, 1, { board: 1 });
    await cacheAt(factory, 2, { board: 2, other: 9 });
    await cacheAt(factory, 3, { other: 8 });
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 4 });
    const found = await cache.earlierLayouts.find('board');
    expect(summary(found)).toEqual([updateIn(1, 1), updateIn(2, 2)]);
    expect(found.map(({ updateKeys, snapshotVersion }) => [updateKeys, snapshotVersion])).toEqual([
      [[1], undefined],
      [[1], undefined],
    ]);
    cache.close();
  });

  it('finds a compacted board by its snapshot', async () => {
    const factory = new IDBFactory();
    const earlier = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    await earlier.load('board');
    await earlier.compact('board', new Uint8Array([7]));
    earlier.close();
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 3 });
    const [copy] = await cache.earlierLayouts.find('board');
    expect(copy?.board).toEqual({ snapshot: new Uint8Array([7]), updates: [] });
    expect(copy?.snapshotVersion).toBe(1);
    cache.close();
  });

  it("deletes one board's copy from one layout, leaving the others", async () => {
    const factory = new IDBFactory();
    await cacheAt(factory, 1, { board: 1 });
    await cacheAt(factory, 2, { board: 2, other: 9 });
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 3 });
    const [, second] = await cache.earlierLayouts.find('board');
    if (second === undefined) throw new Error('the layout-2 copy was expected');
    await cache.earlierLayouts.delete('board', second);
    expect(summary(await cache.earlierLayouts.find('board'))).toEqual([updateIn(1, 1)]);
    expect(summary(await cache.earlierLayouts.find('other'))).toEqual([updateIn(2, 9)]);
    await cache.earlierLayouts.delete('board', {
      ...second,
      source: 'canvas-board-cache:layout:7:recovery:1',
    });
    expect(await databaseNames(factory)).not.toContain('canvas-board-cache:layout:7:recovery:1');
    cache.close();
  });

  it('deletes only the records it read: one appended after the read stays', async () => {
    const factory = new IDBFactory();
    await cacheAt(factory, 2, { board: 2 });
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 3 });
    const [copy] = await cache.earlierLayouts.find('board');
    if (copy === undefined) throw new Error('the layout-2 copy was expected');
    await cacheAt(factory, 2, { board: 5 });
    await cache.earlierLayouts.delete('board', copy);
    expect(summary(await cache.earlierLayouts.find('board'))).toEqual([updateIn(2, 5)]);
    cache.close();
  });

  it('keeps a snapshot another tab compacted after the read', async () => {
    const factory = new IDBFactory();
    const earlier = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    await earlier.load('board');
    await earlier.compact('board', new Uint8Array([7]));
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 3 });
    const [copy] = await cache.earlierLayouts.find('board');
    if (copy === undefined) throw new Error('the layout-2 copy was expected');
    await earlier.compact('board', new Uint8Array([8]));
    earlier.close();
    await cache.earlierLayouts.delete('board', copy);
    const [left] = await cache.earlierLayouts.find('board');
    expect(left?.board.snapshot).toEqual(new Uint8Array([8]));
    if (left === undefined) throw new Error('the newer snapshot was expected');
    await cache.earlierLayouts.delete('board', left);
    expect(await cache.earlierLayouts.find('board')).toEqual([]);
    cache.close();
  });

  it('finds the boards left in the unsuffixed database, as layout 1, first', async () => {
    const factory = new IDBFactory();
    const layoutOne = stampedBoard(1);
    const unreadable = new Uint8Array([255, 255]);
    await seedUnsuffixed(factory, {
      stamped: [layoutOne],
      copied: [stampedBoard()],
      broken: [unreadable],
    });
    await cacheAt(factory, 1, { stamped: 1 });
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 2, onError: vi.fn() });
    const preLayout = {
      source: 'canvas-board-cache',
      layoutVersion: 1,
      isPreLayoutCache: true,
    };
    expect(summary(await cache.earlierLayouts.find('stamped'))).toEqual([
      { ...preLayout, board: { snapshot: undefined, updates: [layoutOne] } },
      updateIn(1, 1),
    ]);
    expect(await cache.earlierLayouts.find('copied')).toEqual([]);
    expect(summary(await cache.earlierLayouts.find('broken'))).toEqual([
      { ...preLayout, board: { snapshot: undefined, updates: [unreadable] } },
    ]);
    const [left] = await cache.earlierLayouts.find('broken');
    if (left === undefined) throw new Error('the unreadable copy was expected');
    await cache.earlierLayouts.delete('broken', left);
    expect(await cache.earlierLayouts.find('broken')).toEqual([]);
    expect(summary(await cache.earlierLayouts.find('stamped'))).toHaveLength(2);
    cache.close();
  });

  it('reads a compacted board left behind with its snapshot', async () => {
    const factory = new IDBFactory();
    await seedUnsuffixed(factory, {});
    const request = factory.open('canvas-board-cache');
    const database = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
    const transaction = database.transaction('snapshots', 'readwrite');
    const snapshot = stampedBoard(1);
    transaction.objectStore('snapshots').put({ boardId: 'board', version: 4, bytes: snapshot });
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => {
        resolve();
      };
    });
    database.close();
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    const [copy] = await cache.earlierLayouts.find('board');
    expect(copy).toMatchObject({ board: { snapshot, updates: [] }, snapshotVersion: 4 });
    cache.close();
  });

  it('looks in the unsuffixed database only for a build writing layout 2 or later', async () => {
    const factory = new IDBFactory();
    await seedUnsuffixed(factory, { stamped: [stampedBoard(1)] });
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 1 });
    expect(await cache.earlierLayouts.find('stamped')).toEqual([]);
    cache.close();
  });

  it('ignores a database of an earlier layout name that is not a cache', async () => {
    const factory = new IDBFactory();
    const request = factory.open('canvas-board-cache:layout:1:recovery:1', 1);
    await new Promise((resolve) => {
      request.onsuccess = resolve;
    });
    request.result.close();
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    expect(await cache.earlierLayouts.find('board')).toEqual([]);
    cache.close();
  });

  it('rejects a read whose transaction aborts, and closes the database', async () => {
    const factory = new IDBFactory();
    await cacheAt(factory, 1, { board: 1 });
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    const { transaction } = IDBDatabase.prototype as {
      transaction: (
        this: IDBDatabase,
        ...args: Parameters<IDBDatabase['transaction']>
      ) => IDBTransaction;
    };
    // fake-indexeddb opens its own transactions too (a version change): abort only the read.
    let isAborting = true;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const created = transaction.apply(this, args);
      if (isAborting && this.name === 'canvas-board-cache:layout:1:recovery:1') {
        isAborting = false;
        queueMicrotask(() => {
          created.abort();
        });
      }
      return created;
    });
    await expect(cache.earlierLayouts.find('board')).rejects.toThrow();
    expect(await cache.earlierLayouts.find('board')).toHaveLength(1);
    cache.close();
  });

  it("uses this build's layout by default, where no build ever wrote an earlier one", async () => {
    const factory = new IDBFactory();
    const cache = await openIndexedDbCache({ factory, databaseName: 'custom' });
    expect(cache.earlierLayouts.writerLayoutVersion).toBe(DOCUMENT_LAYOUT_VERSION);
    expect(await databaseNames(factory)).toEqual([
      `custom:layout:${String(DOCUMENT_LAYOUT_VERSION)}:recovery:1`,
    ]);
    cache.close();
  });
});

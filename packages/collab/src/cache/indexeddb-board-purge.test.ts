import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import { DOCUMENT_LAYOUT_VERSION } from '@canvas/document';

import { deleteIndexedDbBoards } from './indexeddb-board-purge.js';
import { openIndexedDbCache } from './indexeddb-cache.js';

/** Two people's keys for one board, as the site scopes them, and a playground key. */
const ALAN = 'user:11111111-1111-4111-8111-111111111111/board:';
const GRACE = 'user:22222222-2222-4222-8222-222222222222/board:';

/**
 * Whether a key is Alan's.
 *
 * @param boardId - The stored key.
 * @returns Whether it starts with Alan's prefix.
 */
function isAlans(boardId: string): boolean {
  return boardId.startsWith(ALAN);
}

/**
 * Stores boards in the cache a build writing `layout` opens: an update each, and for the boards
 * named in `compacted` a snapshot too.
 *
 * @param factory - The IndexedDB factory.
 * @param layout - The writer layout of that build.
 * @param boards - The boards' keys.
 * @param compacted - The boards compacted into a snapshot after their update.
 */
async function cacheAt(
  factory: IDBFactory,
  layout: number,
  boards: readonly string[],
  compacted: readonly string[] = [],
): Promise<void> {
  const cache = await openIndexedDbCache({ factory, writerLayoutVersion: layout });
  for (const boardId of boards) await cache.append(boardId, new Uint8Array([layout]));
  for (const boardId of compacted) {
    await cache.load(boardId);
    await cache.compact(boardId, new Uint8Array([layout, 0]));
    await cache.append(boardId, new Uint8Array([layout, 1]));
  }
  cache.close();
}

/**
 * Creates the unsuffixed pre- database with the cache's schema and one update per board.
 *
 * @param factory - The IndexedDB factory.
 * @param boards - The boards' keys.
 */
async function seedUnsuffixed(factory: IDBFactory, boards: readonly string[]): Promise<void> {
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
  for (const boardId of boards) {
    // An empty Yjs update: readable, unstamped, so layout 2's first open copies it.
    transaction.objectStore('updates').add({ boardId, bytes: new Uint8Array([0, 0]) });
  }
  await new Promise<void>((resolve) => {
    transaction.oncomplete = () => {
      resolve();
    };
  });
  database.close();
}

/**
 * The board keys one database holds, in its snapshots and in its log, sorted.
 *
 * @param factory - The IndexedDB factory.
 * @param name - The database.
 * @returns The keys.
 */
async function keysIn(
  factory: IDBFactory,
  name: string,
): Promise<{ snapshots: string[]; updates: string[] }> {
  const database = await new Promise<IDBDatabase>((resolve) => {
    const request = factory.open(name);
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
  const transaction = database.transaction(['snapshots', 'updates'], 'readonly');
  const snapshots = transaction.objectStore('snapshots').getAllKeys();
  const updates = transaction.objectStore('updates').getAll();
  await new Promise<void>((resolve) => {
    transaction.oncomplete = () => {
      resolve();
    };
  });
  database.close();
  return {
    snapshots: (snapshots.result as string[]).sort(),
    updates: (updates.result as { boardId: string }[]).map(({ boardId }) => boardId).sort(),
  };
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

describe('deleteIndexedDbBoards', () => {
  it('deletes one person’s boards from every layout’s database and leaves the other’s', async () => {
    const factory = new IDBFactory();
    await seedUnsuffixed(factory, [`${ALAN}a`, `${GRACE}a`, 'playground']);
    await cacheAt(factory, 1, [`${ALAN}a`, `${GRACE}b`]);
    await cacheAt(factory, 2, [`${ALAN}a`, `${ALAN}b`, `${GRACE}a`], [`${ALAN}a`, `${GRACE}a`]);
    // A later build's database, left by a build that ran before a rollback.
    await cacheAt(factory, 3, [`${ALAN}c`, `${GRACE}c`], [`${ALAN}c`]);

    await deleteIndexedDbBoards({ factory, isDeleted: isAlans, writerLayoutVersion: 2 });

    expect(await keysIn(factory, 'canvas-board-cache')).toEqual({
      snapshots: [],
      updates: ['playground', `${GRACE}a`],
    });
    expect(await keysIn(factory, 'canvas-board-cache:layout:1:recovery:1')).toEqual({
      snapshots: [],
      updates: [`${GRACE}b`],
    });
    // Layout 2's first open copied the unsuffixed boards; Grace's was compacted, then written.
    expect(await keysIn(factory, 'canvas-board-cache:layout:2:recovery:1')).toEqual({
      snapshots: [`${GRACE}a`],
      updates: ['playground', `${GRACE}a`],
    });
    expect(await keysIn(factory, 'canvas-board-cache:layout:3:recovery:1')).toEqual({
      snapshots: [],
      updates: [`${GRACE}c`],
    });
  });

  it('leaves the other person’s boards whole: their copy still loads as it was', async () => {
    const factory = new IDBFactory();
    await cacheAt(factory, 2, [`${ALAN}a`, `${GRACE}a`], [`${GRACE}a`]);
    await deleteIndexedDbBoards({ factory, isDeleted: isAlans, writerLayoutVersion: 2 });
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    expect(await cache.load(`${GRACE}a`)).toEqual({
      snapshot: new Uint8Array([2, 0]),
      updates: [new Uint8Array([2, 1])],
    });
    expect(await cache.load(`${ALAN}a`)).toEqual({ snapshot: undefined, updates: [] });
    cache.close();
  });

  it('creates no database where none exists, and touches no other namespace', async () => {
    const factory = new IDBFactory();
    await cacheAt(factory, DOCUMENT_LAYOUT_VERSION, [`${ALAN}a`]);
    const other = await openIndexedDbCache({ factory, databaseName: 'other-cache' });
    await other.append(`${ALAN}a`, new Uint8Array([7]));
    other.close();
    await deleteIndexedDbBoards({ factory, isDeleted: isAlans });
    expect(await databaseNames(factory)).toEqual([
      `canvas-board-cache:layout:${String(DOCUMENT_LAYOUT_VERSION)}:recovery:1`,
      `other-cache:layout:${String(DOCUMENT_LAYOUT_VERSION)}:recovery:1`,
    ]);
    expect(
      await keysIn(factory, `other-cache:layout:${String(DOCUMENT_LAYOUT_VERSION)}:recovery:1`),
    ).toEqual({
      snapshots: [],
      updates: [`${ALAN}a`],
    });
  });

  it('reads the layouts up to the writer’s where the browser cannot list databases', async () => {
    const factory = new IDBFactory();
    await cacheAt(factory, 1, [`${ALAN}a`]);
    await cacheAt(factory, 2, [`${ALAN}a`]);
    Object.defineProperty(factory, 'databases', { value: undefined });
    await deleteIndexedDbBoards({ factory, isDeleted: isAlans, writerLayoutVersion: 2 });
    expect(await keysIn(factory, 'canvas-board-cache:layout:1:recovery:1')).toEqual({
      snapshots: [],
      updates: [],
    });
    expect(await keysIn(factory, 'canvas-board-cache:layout:2:recovery:1')).toEqual({
      snapshots: [],
      updates: [],
    });
  });

  it('runs after a write another connection requested first, so that write is deleted too', async () => {
    const factory = new IDBFactory();
    const cache = await openIndexedDbCache({ factory, writerLayoutVersion: 2 });
    const write = cache.append(`${ALAN}a`, new Uint8Array([1]));
    await deleteIndexedDbBoards({ factory, isDeleted: isAlans, writerLayoutVersion: 2 });
    await write;
    cache.close();
    expect(await keysIn(factory, 'canvas-board-cache:layout:2:recovery:1')).toEqual({
      snapshots: [],
      updates: [],
    });
  });

  it('rejects when a database cannot be opened, so the caller can say so and try again', async () => {
    const factory = new IDBFactory();
    await cacheAt(factory, 2, [`${ALAN}a`]);
    const refusal = new DOMException('Storage is blocked.', 'UnknownError');
    vi.spyOn(factory, 'open').mockImplementation(() => {
      throw refusal;
    });
    await expect(
      deleteIndexedDbBoards({ factory, isDeleted: isAlans, writerLayoutVersion: 2 }),
    ).rejects.toBe(refusal);
    vi.restoreAllMocks();
    expect(await keysIn(factory, 'canvas-board-cache:layout:2:recovery:1')).toEqual({
      snapshots: [],
      updates: [`${ALAN}a`],
    });
  });
});

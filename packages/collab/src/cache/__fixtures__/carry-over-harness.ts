import type { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';

import { DocumentCacheBinding } from '../document-cache-binding.js';
import type { DocumentCache } from '../document-cache.js';
import { openIndexedDbCache } from '../indexeddb-cache.js';
import { LayoutCarryOver, type LayoutCarryOverOptions } from '../layout-carry-over.js';

/** The board every test caches. */
export const BOARD = 'board-1';

/** A scheduler that never runs compactions: these tests never reach 500 updates. */
const idleScheduler = {
  schedule: () => ({ cancel: () => undefined }),
};

/** A board opened by the build after the bump, synced with the relay. */
export interface Opened {
  readonly cache: DocumentCache;
  readonly store: YjsDocumentStore;
  readonly binding: DocumentCacheBinding;
}

/**
 * Opens the board as the build writing `layout` does, and syncs its store with the relay.
 *
 * @param factory - The IndexedDB factory.
 * @param layout - The new build's writer layout.
 * @param relay - The relay's board.
 * @returns The cache, the store and its binding.
 */
export async function openSynced(
  factory: IDBFactory,
  layout: number,
  relay: YjsDocumentStore,
): Promise<Opened> {
  const cache = await openIndexedDbCache({ factory, writerLayoutVersion: layout });
  const store = new YjsDocumentStore({ clientId: 3 });
  const binding = await DocumentCacheBinding.open({ store, cache, boardId: BOARD, idleScheduler });
  store.applyUpdate(relay.encodeState(), SYSTEM_ORIGIN);
  await binding.flush();
  return { cache, store, binding };
}

/**
 * The carry-over of an opened board.
 *
 * @param opened - The board.
 * @param options - Converters and error reporting.
 * @param options.converters - The registry; the build's default when absent.
 * @param options.onError - Receives failures; a spy by default.
 * @param options.storeDurably - Stores carried edits; the opened cache's `append` by default.
 * @returns The carry-over.
 * @throws {Error} When the cache has no earlier layouts (never, for the IndexedDB cache).
 */
export function carryOverOf(
  opened: Opened,
  options: Partial<Pick<LayoutCarryOverOptions, 'converters' | 'onError' | 'storeDurably'>> = {},
): LayoutCarryOver {
  const { earlierLayouts } = opened.cache;
  if (earlierLayouts === undefined) throw new Error('the IndexedDB cache has earlier layouts');
  return new LayoutCarryOver({
    store: opened.store,
    boardId: BOARD,
    earlierLayouts,
    storeDurably: options.storeDurably ?? ((update) => opened.cache.append(BOARD, update)),
    onError: options.onError ?? vi.fn(),
    ...(options.converters === undefined ? {} : { converters: options.converters }),
  });
}

/**
 * Writes boards into the unsuffixed pre- database, as a build before left them.
 *
 * @param factory - The IndexedDB factory.
 * @param boards - Each board's update records.
 */
export async function seedPreLayoutCache(
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

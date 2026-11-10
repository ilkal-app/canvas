import { DOCUMENT_LAYOUT_VERSION } from '@canvas/document';

import { reportAsynchronously } from '../errors/report-asynchronously.js';

import type { DocumentCache } from './document-cache.js';
import { IndexedDbDocumentCache } from './indexeddb-document-cache.js';
import { createIndexedDbEarlierLayouts, layoutDatabaseName } from './indexeddb-earlier-layouts.js';
import { capturePreviousFormat, readPreviousFormat } from './indexeddb-previous-format.js';
import { SNAPSHOTS, UPDATES, UPDATES_BY_BOARD } from './indexeddb-records.js';
import { openExistingDatabase, readLegacyRecords } from './legacy-cache-copy.js';

/** The default cache namespace; the physical database adds the writer-layout suffix. */
export const DEFAULT_CACHE_DATABASE_NAME = 'canvas-board-cache';

/** New physical format; older builds keep writing their original database at schema 1. */
const DATABASE_VERSION = 1;
/** Where {@link openIndexedDbCache} opens its database. */
export interface IndexedDbCacheOptions {
  /**
   * The database namespace; default {@link DEFAULT_CACHE_DATABASE_NAME}. The physical name
   * appends `:layout:<writer version>:recovery:1` even for a custom namespace, isolating older writers.
   */
  readonly databaseName?: string;
  /** The IndexedDB factory; default `globalThis.indexedDB` (tests pass `fake-indexeddb`'s). */
  readonly factory?: IDBFactory;
  /**
   * The stored layout this build writes; default `DOCUMENT_LAYOUT_VERSION`. It names the
   * database and bounds the earlier layouts' databases (`earlierLayouts`); tests pass a later
   * one to open the cache as the build after a layout bump would.
   */
  readonly writerLayoutVersion?: number;
  /**
   * Receives each legacy board the one-time layout-2 copy could not read: it is left out of the
   * copy (and stays in the unsuffixed database) instead of refusing the cache. Default: rethrown
   * from a microtask, where the host's error reporting sees it.
   */
  readonly onError?: (error: unknown) => void;
}

/**
 * Creates the object stores of a new database.
 *
 * @param database - The database being created.
 */
function createSchema(database: IDBDatabase): void {
  database.createObjectStore(SNAPSHOTS, { keyPath: 'boardId' });
  const updates = database.createObjectStore(UPDATES, { keyPath: 'seq', autoIncrement: true });
  updates.createIndex(UPDATES_BY_BOARD, 'boardId');
}

/**
 * Opens (creating on first use) the IndexedDB cache of boards (the
 * client's copy, one of the three stores). Two object stores: `snapshots`, one record per
 * board, and `updates`, the log, keyed by an auto-incremented `seq` and indexed by board, so
 * appends from several tabs never collide. The physical database name includes the build's
 * writer layout. The first layout2 creation (or a later layout's, when no layout-2 cache exists)
 * copies eligible legacy records unchanged; the unsuffixed database remains untouched. The cache's `earlierLayouts` reads and deletes the
 * boards the databases of earlier writer layouts hold. Main thread or worker.
 *
 * @param options - The database namespace and factory.
 * @returns The cache, ready for requests, with its earlier layouts.
 * @throws {DOMException} When IndexedDB refuses to open the database (a newer version exists,
 *   storage is disabled).
 */
export async function openIndexedDbCache(
  options: IndexedDbCacheOptions = {},
): Promise<DocumentCache & Required<Pick<DocumentCache, 'earlierLayouts'>>> {
  const factory = options.factory ?? globalThis.indexedDB;
  const namespace = options.databaseName ?? DEFAULT_CACHE_DATABASE_NAME;
  const writerLayoutVersion = options.writerLayoutVersion ?? DOCUMENT_LAYOUT_VERSION;
  const name = layoutDatabaseName(namespace, writerLayoutVersion);
  const previousName = `${namespace}:layout:${String(writerLayoutVersion)}`;
  const previousSources = (boardId: string) =>
    capturePreviousFormat(factory, previousName, boardId);
  const earlierLayouts = createIndexedDbEarlierLayouts(factory, namespace, writerLayoutVersion);
  const existing = await openExistingDatabase(factory, name);
  if (existing?.version === DATABASE_VERSION)
    return new IndexedDbDocumentCache(existing, earlierLayouts, previousSources);
  existing?.close();
  const legacy =
    existing === undefined
      ? ((await readPreviousFormat(factory, previousName)) ??
        (await readLegacyRecords(factory, namespace, writerLayoutVersion)))
      : undefined;
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) return;
      createSchema(request.result);
      const transaction = request.transaction;
      if (transaction === null) throw new Error('Cache upgrade has no transaction.');
      for (const snapshot of legacy?.snapshots ?? [])
        transaction.objectStore(SNAPSHOTS).put(snapshot);
      for (const update of legacy?.updates ?? []) transaction.objectStore(UPDATES).add(update);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB refused to open the cache.'));
    };
  });
  const report = options.onError ?? reportAsynchronously;
  for (const { boardId, error } of legacy?.unreadableBoards ?? []) {
    report(
      new Error(`Legacy offline cache of board ${boardId} could not be read; it was not copied.`, {
        cause: error,
      }),
    );
  }
  return new IndexedDbDocumentCache(database, earlierLayouts, previousSources);
}

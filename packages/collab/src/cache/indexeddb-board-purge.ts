import { DOCUMENT_LAYOUT_VERSION } from '@canvas/document';

import { DEFAULT_CACHE_DATABASE_NAME } from './indexeddb-cache.js';
import { layoutDatabaseName, transact, withExisting } from './indexeddb-earlier-layouts.js';
import { SNAPSHOTS, UPDATES, UPDATES_BY_BOARD } from './indexeddb-records.js';

/** Which boards {@link deleteIndexedDbBoards} deletes, and from which databases. */
export interface IndexedDbBoardPurgeOptions {
  /**
   * Whether a stored board goes: called with each board key a database holds (the key the
   * cache was given, such as the site's per-person `user:<id>/board:<id>`). Pure.
   */
  readonly isDeleted: (boardId: string) => boolean;
  /** The cache namespace; default {@link DEFAULT_CACHE_DATABASE_NAME}. */
  readonly databaseName?: string;
  /** The IndexedDB factory; default `globalThis.indexedDB` (tests pass `fake-indexeddb`'s). */
  readonly factory?: IDBFactory;
  /** The stored layout this build writes; default `DOCUMENT_LAYOUT_VERSION`. */
  readonly writerLayoutVersion?: number;
}

/**
 * Every database of a namespace that may hold boards: the unsuffixed pre- one, each
 * `<namespace>:layout:<n>` up to the writer layout, and any later layout's the factory lists (a
 * newer build that ran on this device before a rollback).
 *
 * @param factory - The IndexedDB factory.
 * @param namespace - The cache namespace.
 * @param writerLayoutVersion - The stored layout this build writes.
 * @returns The names, each once.
 */
async function databasesOf(
  factory: IDBFactory,
  namespace: string,
  writerLayoutVersion: number,
): Promise<readonly string[]> {
  const names = new Set<string>([namespace]);
  for (let layout = 1; layout <= writerLayoutVersion; layout += 1) {
    names.add(layoutDatabaseName(namespace, layout));
    names.add(`${namespace}:layout:${String(layout)}`);
  }
  // `databases()` is missing in older browsers; the names above are then all that is read.
  const listed = typeof factory.databases === 'function' ? await factory.databases() : [];
  const layoutPrefix = `${namespace}:layout:`;
  for (const { name } of listed) {
    if (
      name?.startsWith(layoutPrefix) === true &&
      /^\d+(?::recovery:1)?$/.test(name.slice(layoutPrefix.length))
    ) {
      names.add(name);
    }
  }
  return [...names];
}

/**
 * Deletes the boards `isDeleted` picks from one open cache database, in one transaction: their
 * snapshots, and every update record of theirs (whoever appended it).
 *
 * @param database - The database.
 * @param isDeleted - Which boards go.
 * @returns Resolves once the transaction has committed.
 */
function deleteFrom(database: IDBDatabase, isDeleted: (boardId: string) => boolean): Promise<void> {
  return transact(database, 'readwrite', (transaction) => {
    const snapshots = transaction.objectStore(SNAPSHOTS);
    const updates = transaction.objectStore(UPDATES);
    const snapshotKeys = snapshots.getAllKeys();
    snapshotKeys.onsuccess = () => {
      for (const key of snapshotKeys.result) {
        if (typeof key === 'string' && isDeleted(key)) snapshots.delete(key);
      }
    };
    const byBoard = updates.index(UPDATES_BY_BOARD);
    // One step per board, not per record: the cursor visits each board key once.
    const boards = byBoard.openKeyCursor(null, 'nextunique');
    boards.onsuccess = () => {
      const cursor = boards.result;
      if (cursor === null) return;
      const { key } = cursor;
      if (typeof key === 'string' && isDeleted(key)) {
        const records = byBoard.getAllKeys(key);
        records.onsuccess = () => {
          for (const record of records.result) updates.delete(record);
        };
      }
      cursor.continue();
    };
    return () => undefined;
  });
}

/**
 * Deletes boards from every IndexedDB cache database of a namespace on the device: the current
 * writer layout's, every earlier layout's (reads them), the unsuffixed pre- one,
 * and a later layout's the factory lists, so no copy of those boards is left for anyone to read
 * with the browser's tools. Only the boards `isDeleted` picks go; the databases themselves stay
 * (other keys in them are someone else's). A database that does not exist is not created. Each
 * database is changed in one transaction, after any transaction already requested on it, and a
 * request made after that sees the boards gone; the caller makes sure no connection of its own
 * writes those boards again meanwhile (the site closes them first). Main thread or worker.
 *
 * @param options - Which boards, and the namespace, factory and writer layout.
 * @returns Resolves once every database has committed.
 * @throws {DOMException} When a database cannot be opened or changed (as a rejection); the
 *   databases before it are already done, and running it again finishes the rest.
 */
export async function deleteIndexedDbBoards(options: IndexedDbBoardPurgeOptions): Promise<void> {
  const factory = options.factory ?? globalThis.indexedDB;
  const namespace = options.databaseName ?? DEFAULT_CACHE_DATABASE_NAME;
  const writerLayoutVersion = options.writerLayoutVersion ?? DOCUMENT_LAYOUT_VERSION;
  for (const name of await databasesOf(factory, namespace, writerLayoutVersion)) {
    await withExisting(factory, name, (database) => deleteFrom(database, options.isDeleted));
  }
}

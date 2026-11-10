import type { EarlierLayoutBoard, EarlierLayoutCaches } from './document-cache.js';
import {
  SNAPSHOTS,
  UPDATES,
  UPDATES_BY_BOARD,
  type SnapshotRecord,
  type StoredUpdateRecord,
} from './indexeddb-records.js';
import { classifyLegacyBoard, openExistingDatabase } from './legacy-cache-copy.js';

/**
 * The physical name of one writer layout's cache database.
 *
 * @param namespace - The cache namespace (`DEFAULT_CACHE_DATABASE_NAME` by default).
 * @param layoutVersion - The writer layout.
 * @returns `<namespace>:layout:<layoutVersion>:recovery:1`.
 */
export function layoutDatabaseName(namespace: string, layoutVersion: number): string {
  return `${namespace}:layout:${String(layoutVersion)}:recovery:1`;
}

/**
 * Runs one transaction over both stores of an open cache database.
 *
 * @param database - The database.
 * @param mode - The transaction mode.
 * @param run - Makes the requests synchronously; returns how to read the result.
 * @returns The result, once the transaction has committed.
 */
export function transact<Result>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => () => Result,
): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    const transaction = database.transaction([SNAPSHOTS, UPDATES], mode);
    const readResult = run(transaction);
    transaction.oncomplete = () => {
      resolve(readResult());
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('The earlier-layout cache transaction aborted.'));
    };
  });
}

/**
 * Opens a cache database when it exists and has the cache's stores (an earlier layout's, or any
 * other of the namespace), runs `use` on it, and closes it; opening one that does not exist
 * creates nothing.
 *
 * @param factory - The IndexedDB factory.
 * @param name - The physical database name.
 * @param use - What to do with the open database.
 * @returns What `use` returned, or `undefined` when there is no such database.
 */
export async function withExisting<Result>(
  factory: IDBFactory,
  name: string,
  use: (database: IDBDatabase) => Promise<Result>,
): Promise<Result | undefined> {
  const database = await openExistingDatabase(factory, name);
  if (database === undefined) return undefined;
  try {
    const hasStores =
      database.objectStoreNames.contains(SNAPSHOTS) && database.objectStoreNames.contains(UPDATES);
    return hasStores ? await use(database) : undefined;
  } finally {
    database.close();
  }
}

/** One board as read from one database, with what a later delete may remove. */
type ReadCopy = Pick<
  EarlierLayoutBoard,
  'board' | 'updateKeys' | 'snapshotVersion' | 'shouldRecover' | 'replayPolicy'
>;

/**
 * Reads one board from an open cache database, with its record keys, without remembering
 * anything (this is not a `DocumentCache` connection: nothing compacts here).
 *
 * @param database - The database.
 * @param boardId - The board.
 * @returns The board's snapshot and updates, the update keys and the snapshot's version.
 */
function readBoard(database: IDBDatabase, boardId: string): Promise<ReadCopy> {
  return transact(database, 'readonly', (transaction) => {
    const snapshot = transaction.objectStore(SNAPSHOTS).get(boardId);
    const updates = transaction.objectStore(UPDATES).index(UPDATES_BY_BOARD).getAll(boardId);
    return () => {
      const snapshotRecord = snapshot.result as SnapshotRecord | undefined;
      const updateRecords = updates.result as StoredUpdateRecord[];
      return {
        ...(snapshotRecord?.previousFormatReplayPolicy === 'manual' ||
        snapshotRecord?.retained?.some((source) => source.replayPolicy === 'manual') === true
          ? { replayPolicy: 'manual' as const }
          : {}),
        board: {
          snapshot: snapshotRecord?.bytes,
          updates: [
            ...(snapshotRecord?.retained ?? []).flatMap((record) =>
              record.bytes === undefined ? [] : [record.bytes],
            ),
            ...updateRecords.map((record) => record.bytes),
          ],
        },
        updateKeys: updateRecords.map((record) => record.seq),
        snapshotVersion: snapshotRecord?.version,
        ...((snapshotRecord?.retained?.length ?? 0) > 0 ? { shouldRecover: true as const } : {}),
      };
    };
  });
}

/**
 * Deletes the records a copy was read from: its update keys, and its snapshot while the stored
 * one still has the version read. Records stored since stay.
 *
 * @param database - The database.
 * @param boardId - The board.
 * @param copy - What was read.
 * @returns Resolves once they are gone.
 */
function deleteRead(database: IDBDatabase, boardId: string, copy: ReadCopy): Promise<void> {
  return transact(database, 'readwrite', (transaction) => {
    const snapshots = transaction.objectStore(SNAPSHOTS);
    const stored = snapshots.get(boardId);
    stored.onsuccess = () => {
      const record = stored.result as SnapshotRecord | undefined;
      // A retained generation may receive late old-tab writes. Preserve its complete base
      // and tail until a separate retention policy can prove retirement safe.
      if ((record?.retained?.length ?? 0) > 0) return;
      const updates = transaction.objectStore(UPDATES);
      for (const key of copy.updateKeys) updates.delete(key);
      if (record !== undefined && record.version === copy.snapshotVersion)
        snapshots.delete(boardId);
    };
    return () => undefined;
  });
}

/**
 * Whether a read copy holds anything.
 *
 * @param copy - The copy.
 * @returns Whether it has a snapshot or an update.
 */
function hasContent(copy: ReadCopy | undefined): copy is ReadCopy {
  return copy !== undefined && (copy.board.snapshot !== undefined || copy.board.updates.length > 0);
}

/**
 * Reads a board from the unsuffixed pre- database when's copy left it behind (a
 * layout-1 stamp, or bytes it could not read); a board it copied is not reported again.
 *
 * @param factory - The IndexedDB factory.
 * @param namespace - The cache namespace: the unsuffixed database's name.
 * @param boardId - The board.
 * @returns The copy, or `undefined`.
 */
async function findLeftBehind(
  factory: IDBFactory,
  namespace: string,
  boardId: string,
): Promise<EarlierLayoutBoard | undefined> {
  const copy = await withExisting(factory, namespace, (database) => readBoard(database, boardId));
  if (!hasContent(copy)) return undefined;
  const { snapshot, updates } = copy.board;
  const verdict = classifyLegacyBoard(snapshot === undefined ? updates : [snapshot, ...updates]);
  if (verdict.kind === 'copied') return undefined;
  return { ...copy, source: namespace, layoutVersion: 1, isPreLayoutCache: true };
}

/**
 * The earlier writer layouts' IndexedDB caches of a namespace: first the unsuffixed
 * pre- database (for a writer layout from 2 up), whose boards count as layout 1 but only
 * those's one-time copy left behind; then `<namespace>:layout:<n>` for every `n` from
 * 1 below `writerLayoutVersion`. Only databases that exist are read (opening one that does not
 * creates nothing). Each request opens the databases it needs and closes them again, so an idle
 * page holds no connection to them and never blocks another build's upgrade. A delete removes
 * only the records `find` read. Main thread or worker.
 *
 * @param factory - The IndexedDB factory.
 * @param namespace - The cache namespace.
 * @param writerLayoutVersion - The stored layout this build writes.
 * @returns The earlier layouts' caches.
 */
export function createIndexedDbEarlierLayouts(
  factory: IDBFactory,
  namespace: string,
  writerLayoutVersion: number,
): EarlierLayoutCaches {
  return {
    writerLayoutVersion,
    async find(boardId) {
      const found: EarlierLayoutBoard[] = [];
      if (writerLayoutVersion >= 2) {
        const leftBehind = await findLeftBehind(factory, namespace, boardId);
        if (leftBehind !== undefined) found.push(leftBehind);
      }
      for (let layoutVersion = 1; layoutVersion <= writerLayoutVersion; layoutVersion += 1) {
        const recoveryCopy = await withExisting(
          factory,
          layoutDatabaseName(namespace, layoutVersion),
          (database) => readBoard(database, boardId),
        );
        const sources = [`${namespace}:layout:${String(layoutVersion)}`];
        if (layoutVersion < writerLayoutVersion)
          sources.push(layoutDatabaseName(namespace, layoutVersion));
        for (const source of sources) {
          const copy = await withExisting(factory, source, (database) =>
            readBoard(database, boardId),
          );
          if (hasContent(copy))
            found.push({
              ...copy,
              ...(recoveryCopy?.replayPolicy === 'manual'
                ? { replayPolicy: 'manual' as const }
                : {}),
              source,
              layoutVersion,
              isPreLayoutCache: false,
              ...(source.endsWith(':recovery:1') || layoutVersion < writerLayoutVersion
                ? {}
                : { shouldRecover: true as const }),
            });
        }
      }
      // Read the current fence after the sources so a publication during their reads wins.
      const current = await withExisting(
        factory,
        layoutDatabaseName(namespace, writerLayoutVersion),
        (database) => readBoard(database, boardId),
      );
      return current?.replayPolicy === 'manual'
        ? found.map((copy) => ({ ...copy, replayPolicy: 'manual' as const }))
        : found;
    },
    async delete(boardId, copy) {
      if (copy.shouldRecover === true || copy.replayPolicy === 'manual') return;
      await withExisting(factory, copy.source, (database) => deleteRead(database, boardId, copy));
    },
  };
}

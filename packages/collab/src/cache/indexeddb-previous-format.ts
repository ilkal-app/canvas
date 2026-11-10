import type { CapturedRecovery } from './document-cache.js';
import { transact, withExisting } from './indexeddb-earlier-layouts.js';
import {
  SNAPSHOTS,
  UPDATES,
  UPDATES_BY_BOARD,
  type SnapshotRecord,
  type StoredUpdateRecord,
} from './indexeddb-records.js';

/** Exact records copied once from the previous physical cache format. */
export interface PreviousFormatRecords {
  /** Original snapshots, including their persistence versions. */
  readonly snapshots: readonly SnapshotRecord[];
  /** Original tails, including their persistence keys. */
  readonly updates: readonly StoredUpdateRecord[];
  /** The previous format has no legacy classification failures. */
  readonly unreadableBoards: readonly [];
}

/**
 * Reads the preceding physical format without upgrading it or closing its writers.
 *
 * @param factory - IndexedDB implementation.
 * @param name - Previous physical database name.
 * @returns A consistent copy, or undefined when that database does not exist.
 */
export function readPreviousFormat(
  factory: IDBFactory,
  name: string,
): Promise<PreviousFormatRecords | undefined> {
  return withExisting(factory, name, (database) =>
    transact(database, 'readonly', (transaction) => {
      const snapshots = transaction.objectStore(SNAPSHOTS).getAll();
      const updates = transaction.objectStore(UPDATES).getAll();
      return () => ({
        snapshots: snapshots.result as SnapshotRecord[],
        updates: updates.result as StoredUpdateRecord[],
        unreadableBoards: [],
      });
    }),
  );
}

/**
 * Captures the still-writable old format on every recovery read. The negative generation is
 * reserved for this external source; it can never be a publication or compaction target.
 *
 * @param factory - IndexedDB implementation.
 * @param name - Previous physical database name.
 * @param boardId - Board cache key.
 * @returns Original source bytes, including edits appended after the new build first opened.
 */
export async function capturePreviousFormat(
  factory: IDBFactory,
  name: string,
  boardId: string,
): Promise<readonly CapturedRecovery[]> {
  const captured = await withExisting(factory, name, (database) =>
    transact(database, 'readonly', (transaction) => {
      const snapshot = transaction.objectStore(SNAPSHOTS).get(boardId);
      const updates = transaction.objectStore(UPDATES).index(UPDATES_BY_BOARD).getAll(boardId);
      return () => {
        const record = snapshot.result as SnapshotRecord | undefined;
        const tail = updates.result as StoredUpdateRecord[];
        return {
          generation: -1,
          snapshotVersion: record?.version,
          updateKeys: tail.map(({ seq }) => seq),
          board: { snapshot: record?.bytes, updates: tail.map(({ bytes }) => bytes) },
        };
      };
    }),
  );
  return captured === undefined ||
    (captured.board.snapshot === undefined && captured.board.updates.length === 0)
    ? []
    : [captured];
}

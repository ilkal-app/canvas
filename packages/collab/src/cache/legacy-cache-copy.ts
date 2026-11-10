import * as Y from 'yjs';

import { assertUpdateDepth, highestLayoutStamp } from '@canvas/document';

import {
  SNAPSHOTS,
  UPDATES,
  type SnapshotRecord,
  type StoredUpdateRecord,
} from './indexeddb-records.js';

/** Original records eligible for the layout2 namespace; never re-encoded or compacted. */
interface LegacyRecords {
  readonly snapshots: readonly SnapshotRecord[];
  readonly updates: readonly StoredUpdateRecord[];
  /** Boards whose bytes could not be read: left out of the copy, with why. */
  readonly unreadableBoards: readonly UnreadableLegacyBoard[];
}

/** A legacy board the copy could not read; it stays only in the unsuffixed database. */
export interface UnreadableLegacyBoard {
  readonly boardId: string;
  readonly error: unknown;
}

/**
 * Opens an existing database, aborting first creation to leave an absent database absent.
 *
 * @param factory - IndexedDB implementation.
 * @param name - Physical database name.
 * @param version - Required version, or the existing legacy version.
 * @returns The existing connection, or undefined when no database exists.
 */
export function openExistingDatabase(
  factory: IDBFactory,
  name: string,
  version?: number,
): Promise<IDBDatabase | undefined> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    let wasAbsent = false;
    request.onupgradeneeded = (event) => {
      wasAbsent = event.oldVersion === 0;
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      if (wasAbsent) resolve(undefined);
      else reject(request.error ?? new Error('IndexedDB refused to inspect the cache.'));
    };
  });
}

/** The first writer layout whose cache database is suffixed: the one's copy fills. */
const FIRST_SUFFIXED_LAYOUT = 2;

/**
 * Tells whether a build of the first suffixed layout already created its cache database, which
 *'s one-time copy filled when it did.
 *
 * @param factory - IndexedDB implementation.
 * @param name - The unsuffixed namespace.
 * @returns True when either of its databases exists.
 */
async function hasFirstSuffixedCache(factory: IDBFactory, name: string): Promise<boolean> {
  const layout = `${name}:layout:${String(FIRST_SUFFIXED_LAYOUT)}`;
  for (const candidate of [layout, `${layout}:recovery:1`]) {
    const database = await openExistingDatabase(factory, candidate);
    database?.close();
    if (database !== undefined) return true;
  }
  return false;
}

/**
 * Reads one consistent legacy snapshot and tail before starting the destination upgrade.
 * Reading another database inside onupgradeneeded would allow its transaction to auto-commit.
 * The layout-2 writer imports its unsuffixed predecessor; a later writer does too when no
 * layout-2 cache exists (a person who goes from a pre- build straight
 * to a layout-3 build loses no unsent edit; layout 2 bytes are valid layout 3 writes), and
 * otherwise leaves it to the layout-2 cache, which's carry-over reads.
 *
 * @param factory - IndexedDB implementation.
 * @param name - Unsuffixed predecessor of the destination namespace.
 * @param layoutVersion - Writer layout.
 * @returns Original eligible records, or undefined for no legacy database.
 * @throws {Error} If legacy records cannot be inspected; no database is changed.
 */
export async function readLegacyRecords(
  factory: IDBFactory,
  name: string,
  layoutVersion: number,
): Promise<LegacyRecords | undefined> {
  if (layoutVersion < FIRST_SUFFIXED_LAYOUT) return undefined;
  if (layoutVersion > FIRST_SUFFIXED_LAYOUT && (await hasFirstSuffixedCache(factory, name))) {
    return undefined;
  }
  const database = await openExistingDatabase(factory, name);
  if (database === undefined) return undefined;
  try {
    const records = await new Promise<LegacyRecords>((resolve, reject) => {
      const transaction = database.transaction([SNAPSHOTS, UPDATES], 'readonly');
      const snapshots = transaction.objectStore(SNAPSHOTS).getAll();
      const updates = transaction.objectStore(UPDATES).getAll();
      transaction.oncomplete = () => {
        resolve({
          snapshots: snapshots.result as SnapshotRecord[],
          updates: updates.result as StoredUpdateRecord[],
          unreadableBoards: [],
        });
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error('Legacy cache read aborted.'));
      };
    });
    return withoutLayoutOne(records);
  } catch (cause) {
    throw new Error('Legacy offline cache could not be inspected; its data was not changed.', {
      cause,
    });
  } finally {
    database.close();
  }
}

/** How's one-time copy treats one legacy board. */
export type LegacyBoardVerdict =
  | {
      /** Copied into layout 2 (unstamped or layout-2 content). */
      readonly kind: 'copied';
    }
  | {
      /** Left behind: it holds a layout-1 stamp, even a superseded one. */
      readonly kind: 'layout-1';
    }
  | {
      /** Left behind: its bytes cannot be read (malformed, or nested past the bound). */
      readonly kind: 'unreadable';
      /** Why. */
      readonly error: unknown;
    };

/**
 * Decides whether's copy takes a legacy board: it replays the board's records into a
 * scratch document (no garbage collection, so superseded stamps stay visible) and looks for a
 * positive layout-1 stamp. Pure: the records are not changed.
 *
 * @param records - The board's snapshot and updates, in stored order.
 * @returns The verdict.
 */
export function classifyLegacyBoard(records: readonly Uint8Array[]): LegacyBoardVerdict {
  const document = new Y.Doc({ gc: false });
  let verdict: LegacyBoardVerdict;
  try {
    for (const record of records) {
      assertUpdateDepth(record);
      Y.applyUpdate(document, record);
    }
    const isLayoutOne = highestLayoutStamp(document, 1) !== undefined;
    verdict = isLayoutOne ? { kind: 'layout-1' } : { kind: 'copied' };
  } catch (error: unknown) {
    verdict = { kind: 'unreadable', error };
  }
  document.destroy();
  return verdict;
}

/**
 * Leaves out boards with positive layout-1 evidence, and boards whose bytes cannot be read (one
 * such board used to refuse the whole cache open on every load, leaving the device with no
 * offline cache for any board:, from the re-review).
 *
 * @param records - Every legacy record.
 * @returns The eligible records, and the unreadable boards.
 */
function withoutLayoutOne(records: LegacyRecords): LegacyRecords {
  const updatesByBoard = new Map<string, Uint8Array[]>();
  for (const record of [...records.snapshots, ...records.updates]) {
    const updates = updatesByBoard.get(record.boardId) ?? [];
    updates.push(record.bytes);
    updatesByBoard.set(record.boardId, updates);
  }
  const excluded = new Set<string>();
  const unreadableBoards: UnreadableLegacyBoard[] = [];
  for (const [boardId, updates] of updatesByBoard) {
    const verdict = classifyLegacyBoard(updates);
    if (verdict.kind !== 'copied') excluded.add(boardId);
    if (verdict.kind === 'unreadable') unreadableBoards.push({ boardId, error: verdict.error });
  }
  return {
    snapshots: records.snapshots.filter(({ boardId }) => !excluded.has(boardId)),
    updates: records.updates.filter(({ boardId }) => !excluded.has(boardId)),
    unreadableBoards,
  };
}

import type {
  CachedBoard,
  CapturedRecovery,
  DocumentCache,
  EarlierLayoutCaches,
  CacheRecoveryStorage,
} from './document-cache.js';
import {
  SNAPSHOTS,
  UPDATES,
  UPDATES_BY_BOARD,
  type SnapshotRecord,
  type UpdateRecord,
  type StoredUpdateRecord,
} from './indexeddb-records.js';
import { captureGeneration, matchesCapture, publishedSnapshot } from './indexeddb-recovery.js';
import { copySnapshotPreview, type SnapshotPreviewCache } from './snapshot-preview.js';
import type { SnapshotStamp } from './snapshot-stamp.js';

/** A connection's bound generation and records covered by its next compaction. */
interface SeenRecords {
  readonly generation: number;
  snapshotVersion: number | undefined;
  readonly updateKeys: Set<number>;
}

/**
 * A {@link DocumentCache} over one IndexedDB connection. Every request is one transaction,
 * created synchronously when the request is made, so IndexedDB runs them in request order.
 */
export class IndexedDbDocumentCache implements DocumentCache {
  readonly earlierLayouts: EarlierLayoutCaches;
  readonly snapshotPreview: SnapshotPreviewCache = {
    read: (boardId) =>
      this.#transact('readonly', (transaction) => {
        const request = transaction.objectStore(SNAPSHOTS).get(boardId);
        return () => {
          const snapshot = request.result as SnapshotRecord | undefined;
          const seen = this.#seen.get(boardId);
          if (seen !== undefined && seen.generation !== (snapshot?.generation ?? 0))
            return undefined;
          return copySnapshotPreview(snapshot);
        };
      }),
    compact: (boardId, snapshot, preview, stamp) =>
      this.#compact(boardId, snapshot, preview, stamp),
  };
  readonly #database: IDBDatabase;
  readonly #seen = new Map<string, SeenRecords>();
  #isClosed = false;
  readonly #previousSources:
    ((boardId: string) => Promise<readonly CapturedRecovery[]>) | undefined;
  /** Atomic recovery publication and retained generations. */
  readonly recovery: CacheRecoveryStorage = {
    capture: (boardId) =>
      this.#read(boardId, (snapshot, updates) =>
        captureGeneration(snapshot, updates, this.#seenOf(boardId, snapshot).generation),
      ),
    retained: async (boardId) => {
      const previous = (await this.#previousSources?.(boardId)) ?? [];
      return this.#read(boardId, (snapshot, updates) => [
        ...(snapshot?.retained ?? []).map(({ generation }) =>
          captureGeneration(snapshot, updates, generation),
        ),
        ...previous.map((source) =>
          snapshot?.previousFormatReplayPolicy === 'manual'
            ? { ...source, replayPolicy: 'manual' as const }
            : source,
        ),
      ]);
    },
    publish: (boardId, capture, bytes, replayPolicy) => {
      const snapshotBytes = bytes.slice();
      let next: SnapshotRecord | undefined;
      return this.#transact('readwrite', (transaction) => {
        const snapshots = transaction.objectStore(SNAPSHOTS);
        const current = snapshots.get(boardId);
        const updates = transaction.objectStore(UPDATES).index(UPDATES_BY_BOARD).getAll(boardId);
        updates.onsuccess = () => {
          const previous = current.result as SnapshotRecord | undefined;
          const records = updates.result as StoredUpdateRecord[];
          if (!matchesCapture(previous, records, capture)) return;
          next = publishedSnapshot(boardId, previous, snapshotBytes, replayPolicy);
          snapshots.put(next);
        };
        return () => {
          if (next === undefined) return false;
          this.#seen.set(boardId, {
            generation: next.generation ?? 0,
            snapshotVersion: next.version,
            updateKeys: new Set(),
          });
          return true;
        };
      });
    },
  };

  /**
   * Wraps an open connection; it closes itself when another connection upgrades the database,
   * so the upgrade is never blocked by an idle tab.
   *
   * @param database - The open database.
   * @param earlierLayouts - The earlier writer layouts' databases of the same namespace.
   * @param previousSources - Reads still-writable old-format sources without modifying them.
   */
  constructor(
    database: IDBDatabase,
    earlierLayouts: EarlierLayoutCaches,
    previousSources?: (boardId: string) => Promise<readonly CapturedRecovery[]>,
  ) {
    this.#database = database;
    this.#previousSources = previousSources;
    this.earlierLayouts = earlierLayouts;
    database.onversionchange = () => {
      this.close();
    };
  }

  /** @inheritdoc */
  load(boardId: string): Promise<CachedBoard> {
    return this.#read(boardId, (snapshot, updates) => {
      const seen = this.#seenOf(boardId, snapshot);
      const captured = captureGeneration(snapshot, updates, seen.generation);
      seen.snapshotVersion = captured.snapshotVersion;
      for (const key of captured.updateKeys) seen.updateKeys.add(key);
      return captured.board;
    });
  }

  /** @inheritdoc */
  readUpdates(boardId: string): Promise<readonly Uint8Array[]> {
    return this.#read(
      boardId,
      (snapshot, updates) =>
        captureGeneration(snapshot, updates, this.#seenOf(boardId, snapshot).generation).board
          .updates,
    );
  }

  /** @inheritdoc */
  append(boardId: string, update: Uint8Array): Promise<void> {
    const bytes = update.slice();
    return this.#transact('readwrite', (transaction) => {
      const snapshot = transaction.objectStore(SNAPSHOTS).get(boardId);
      let key: number | undefined;
      let seen: SeenRecords;
      snapshot.onsuccess = () => {
        seen = this.#seenOf(boardId, snapshot.result as SnapshotRecord | undefined);
        const record: UpdateRecord = { boardId, bytes, generation: seen.generation };
        const request = transaction.objectStore(UPDATES).add(record);
        request.onsuccess = () => {
          key = request.result as number;
        };
      };
      return () => {
        if (key !== undefined) seen.updateKeys.add(key);
      };
    });
  }

  /** @inheritdoc */
  compact(boardId: string, snapshot: Uint8Array, stamp?: SnapshotStamp): Promise<boolean> {
    return this.#compact(boardId, snapshot, undefined, stamp);
  }

  /**
   * Publishes optional display bytes under the same generation and snapshot CAS.
   *
   * @param boardId - Bound board.
   * @param snapshot - Owned authoritative bytes.
   * @param preview - Optional display-only sidecar.
   * @param stamp - Optional reopen stamp for exactly these bytes.
   * @returns Whether the atomic transaction committed the replacement.
   */
  #compact(
    boardId: string,
    snapshot: Uint8Array,
    preview?: Uint8Array,
    stamp?: SnapshotStamp,
  ): Promise<boolean> {
    const ownedPreview = preview === undefined ? undefined : new Uint8Array(preview);
    let version: number | undefined;
    const bytes = new Uint8Array(snapshot);
    return this.#transact('readwrite', (transaction) => {
      const snapshots = transaction.objectStore(SNAPSHOTS);
      const stored = snapshots.get(boardId);
      stored.onsuccess = () => {
        const previous = stored.result as SnapshotRecord | undefined;
        const seen = this.#seenOf(boardId, previous);
        if (
          seen.generation !== (previous?.generation ?? 0) ||
          previous?.version !== seen.snapshotVersion
        )
          return;
        version = (previous?.version ?? 0) + 1;
        const next = { ...previous, boardId, version, bytes };
        delete next.preview;
        delete next.stamp;
        if (ownedPreview !== undefined) next.preview = ownedPreview;
        if (stamp !== undefined) next.stamp = { ...stamp };
        snapshots.put(next);
        const updates = transaction.objectStore(UPDATES);
        // Appends requested before this compaction have completed, and later ones have not
        // started: the seen keys are exactly the updates `snapshot` covers.
        for (const key of seen.updateKeys) updates.delete(key);
      };
      return () => {
        if (version === undefined) return false;
        const seen = this.#seen.get(boardId);
        if (seen !== undefined) {
          seen.snapshotVersion = version;
          seen.updateKeys.clear();
        }
        return true;
      };
    });
  }

  /** @inheritdoc */
  delete(boardId: string): Promise<void> {
    let isDeleted = false;
    return this.#transact('readwrite', (transaction) => {
      const snapshots = transaction.objectStore(SNAPSHOTS);
      const stored = snapshots.get(boardId);
      stored.onsuccess = () => {
        const snapshot = stored.result as SnapshotRecord | undefined;
        // Recovery sources and their replay fence have no approved retirement policy.
        if (
          snapshot?.retained?.some((source) => source.replayPolicy === 'manual') === true ||
          snapshot?.previousFormatReplayPolicy === 'manual'
        )
          return;
        snapshots.delete(boardId);
        isDeleted = true;
        const updates = transaction.objectStore(UPDATES);
        const keys = updates.index(UPDATES_BY_BOARD).getAllKeys(boardId);
        keys.onsuccess = () => {
          for (const key of keys.result) updates.delete(key);
        };
      };
      return () => {
        if (isDeleted) this.#seen.delete(boardId);
      };
    });
  }

  /** @inheritdoc */
  close(): void {
    this.#isClosed = true;
    this.#database.close();
  }

  /**
   * What this connection has seen of a board, created empty on first use.
   *
   * @param boardId - The board.
   * @param snapshot - Active metadata when first binding.
   * @returns The seen records.
   */
  #seenOf(boardId: string, snapshot: SnapshotRecord | undefined): SeenRecords {
    let seen = this.#seen.get(boardId);
    if (seen === undefined) {
      seen = {
        generation: snapshot?.generation ?? 0,
        snapshotVersion: undefined,
        updateKeys: new Set(),
      };
      this.#seen.set(boardId, seen);
    }
    return seen;
  }

  /**
   * Reads a consistent snapshot and tail in request order.
   *
   * @param boardId - The board.
   * @param read - Computes the result after a committed read.
   * @returns The computed result.
   */
  #read<Result>(
    boardId: string,
    read: (snapshot: SnapshotRecord | undefined, updates: StoredUpdateRecord[]) => Result,
  ): Promise<Result> {
    return this.#transact('readonly', (transaction) => {
      const snapshot = transaction.objectStore(SNAPSHOTS).get(boardId);
      const updates = transaction.objectStore(UPDATES).index(UPDATES_BY_BOARD).getAll(boardId);
      return () =>
        read(snapshot.result as SnapshotRecord | undefined, updates.result as StoredUpdateRecord[]);
    });
  }

  /**
   * Runs one transaction over both stores. `run` makes its requests synchronously and returns
   * how to read the result once the transaction commits.
   *
   * @param mode - The transaction mode.
   * @param run - Makes the requests.
   * @returns The result, once the transaction has committed.
   */
  #transact<Result>(
    mode: IDBTransactionMode,
    run: (transaction: IDBTransaction) => () => Result,
  ): Promise<Result> {
    if (this.#isClosed) return Promise.reject(new Error('The document cache is closed.'));
    return new Promise<Result>((resolve, reject) => {
      const transaction = this.#database.transaction([SNAPSHOTS, UPDATES], mode);
      const readResult = run(transaction);
      transaction.oncomplete = () => {
        try {
          resolve(readResult());
        } catch (error: unknown) {
          reject(
            error instanceof Error
              ? error
              : new Error('Cache result could not be read.', { cause: error }),
          );
        }
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error('The cache transaction was aborted.'));
      };
    });
  }
}

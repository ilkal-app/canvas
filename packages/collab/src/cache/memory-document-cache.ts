import type {
  CachedBoard,
  DocumentCache,
  CacheRecoveryStorage,
  CapturedRecovery,
} from './document-cache.js';
import { copySnapshotPreview, type SnapshotPreviewCache } from './snapshot-preview.js';
import type { SnapshotStamp } from './snapshot-stamp.js';

/** One board's records in a {@link MemoryCacheStorage}, as tests inspect them. */
export interface MemoryStoredBoard {
  /** Explicit discard retains bytes for export, never automatic replay. */
  replayPolicy?: 'manual';
  /** The snapshot and its version (one more per compaction), if any. */
  snapshot:
    | {
        /** One more per compaction, so a connection can tell a snapshot it has not seen. */
        readonly version: number;
        /** The board's state (Yjs update format v1). */
        readonly bytes: Uint8Array;
        /** Optional opaque display bytes paired with the snapshot. */
        readonly preview?: Uint8Array;
        /** The reopen stamp compacted with these bytes, if any. */
        readonly stamp?: SnapshotStamp;
      }
    | undefined;
  /** The log, by update key, in the order appended. */
  readonly updates: Map<number, Uint8Array>;
}

/**
 * The storage behind {@link MemoryDocumentCache} connections: what one IndexedDB database is
 * to the browser's tabs. Share one between several caches to model several tabs.
 */
export class MemoryCacheStorage {
  /** Records by board id. */
  readonly boards = new Map<string, MemoryStoredBoard>();
  /** The next update key; keys grow across every board, like an IndexedDB key generator. */
  nextKey = 1;
  /** Active generation of each board; absent means the original generation. */
  readonly generations = new Map<string, number>();
  /** Older generations remain recoverable, including writes by still-open connections. */
  readonly retained = new Map<string, Map<number, MemoryStoredBoard>>();

  /**
   * A board's records, created empty on first use.
   *
   * @param boardId - The board.
   * @returns The records.
   */
  board(boardId: string): MemoryStoredBoard {
    let board = this.boards.get(boardId);
    if (board === undefined) {
      board = { snapshot: undefined, updates: new Map() };
      this.boards.set(boardId, board);
    }
    return board;
  }
}

/** What one connection has seen of one board. */
interface SeenRecords {
  readonly generation: number;
  snapshotVersion: number | undefined;
  readonly updateKeys: Set<number>;
}

/**
 * A {@link DocumentCache} in memory, for tests and for clients that must not touch storage
 * (headless agents). Requests complete synchronously, in order; the promises they return are
 * already settled.
 */
export class MemoryDocumentCache implements DocumentCache {
  /** @inheritdoc */
  readonly snapshotPreview: SnapshotPreviewCache = {
    read: (boardId) =>
      this.#run(() => {
        const seen = this.#seen.get(boardId);
        if (seen !== undefined && seen.generation !== (this.#storage.generations.get(boardId) ?? 0))
          return undefined;
        return copySnapshotPreview(this.#storage.boards.get(boardId)?.snapshot);
      }),
    compact: (boardId, snapshot, preview, stamp) =>
      this.#compact(boardId, snapshot, preview, stamp),
  };
  readonly #storage: MemoryCacheStorage;
  readonly #seen = new Map<string, SeenRecords>();
  #isClosed = false;
  /** Atomic recovery publication and retained generations. */
  readonly recovery: CacheRecoveryStorage = {
    capture: (boardId) => this.#run(() => this.#capture(boardId, this.#seenOf(boardId).generation)),
    retained: (boardId) =>
      this.#run(() =>
        [...(this.#storage.retained.get(boardId)?.keys() ?? [])].map((generation) =>
          this.#capture(boardId, generation),
        ),
      ),
    publish: (boardId, capture, snapshot, replayPolicy) =>
      this.#run(() => {
        const active = this.#storage.generations.get(boardId) ?? 0;
        const current = this.#capture(boardId, active);
        if (
          active !== capture.generation ||
          current.snapshotVersion !== capture.snapshotVersion ||
          current.updateKeys.length !== capture.updateKeys.length ||
          current.updateKeys.some((key, index) => key !== capture.updateKeys[index])
        )
          return false;
        const bytes = snapshot.slice();
        const retained =
          this.#storage.retained.get(boardId) ?? new Map<number, MemoryStoredBoard>();
        const previous = this.#storage.board(boardId);
        if (replayPolicy !== undefined) previous.replayPolicy = replayPolicy;
        retained.set(active, previous);
        this.#storage.retained.set(boardId, retained);
        this.#storage.boards.set(boardId, {
          snapshot: { version: (current.snapshotVersion ?? 0) + 1, bytes },
          updates: new Map(),
        });
        this.#storage.generations.set(boardId, active + 1);
        this.#seen.delete(boardId);
        const seen = this.#seenOf(boardId);
        seen.snapshotVersion = this.#storage.board(boardId).snapshot?.version;
        return true;
      }),
  };

  /**
   * Opens a connection to a storage.
   *
   * @param storage - The storage; default a new, private one.
   */
  constructor(storage: MemoryCacheStorage = new MemoryCacheStorage()) {
    this.#storage = storage;
  }

  /** @inheritdoc */
  load(boardId: string): Promise<CachedBoard> {
    return this.#run(() => {
      const board = this.#board(boardId, this.#seenOf(boardId).generation);
      const seen = this.#seenOf(boardId);
      seen.snapshotVersion = board.snapshot?.version;
      for (const key of board.updates.keys()) seen.updateKeys.add(key);
      const stamp = board.snapshot?.stamp;
      return {
        snapshot: board.snapshot === undefined ? undefined : new Uint8Array(board.snapshot.bytes),
        updates: [...board.updates.values()].map((update) => new Uint8Array(update)),
        ...(stamp === undefined ? {} : { snapshotStamp: { ...stamp } }),
      };
    });
  }

  /** @inheritdoc */
  readUpdates(boardId: string): Promise<readonly Uint8Array[]> {
    return this.#run(() =>
      [...this.#board(boardId, this.#seenOf(boardId).generation).updates.values()].map((bytes) =>
        bytes.slice(),
      ),
    );
  }

  /** @inheritdoc */
  append(boardId: string, update: Uint8Array): Promise<void> {
    return this.#run(() => {
      const key = this.#storage.nextKey++;
      this.#board(boardId, this.#seenOf(boardId).generation).updates.set(key, update.slice());
      this.#seenOf(boardId).updateKeys.add(key);
    });
  }

  /** @inheritdoc */
  compact(boardId: string, snapshot: Uint8Array, stamp?: SnapshotStamp): Promise<boolean> {
    return this.#compact(boardId, snapshot, undefined, stamp);
  }

  /**
   * Replaces one snapshot and its optional preview under the ordinary seen-record rules.
   *
   * @param boardId - The board.
   * @param snapshot - Full state bytes.
   * @param preview - Optional prepared display bytes.
   * @param stamp - Optional reopen stamp for exactly these bytes.
   * @returns Whether both were stored.
   */
  #compact(
    boardId: string,
    snapshot: Uint8Array,
    preview?: Uint8Array,
    stamp?: SnapshotStamp,
  ): Promise<boolean> {
    return this.#run(() => {
      const board = this.#board(boardId, this.#seenOf(boardId).generation);
      const seen = this.#seenOf(boardId);
      if (
        seen.generation !== (this.#storage.generations.get(boardId) ?? 0) ||
        board.snapshot?.version !== seen.snapshotVersion
      )
        return false;
      const version = (board.snapshot?.version ?? 0) + 1;
      board.snapshot = {
        version,
        bytes: new Uint8Array(snapshot),
        ...(preview === undefined ? {} : { preview: new Uint8Array(preview) }),
        ...(stamp === undefined ? {} : { stamp: { ...stamp } }),
      };
      for (const key of seen.updateKeys) board.updates.delete(key);
      seen.snapshotVersion = version;
      seen.updateKeys.clear();
      return true;
    });
  }

  /** @inheritdoc */
  delete(boardId: string): Promise<void> {
    return this.#run(() => {
      if (
        [...(this.#storage.retained.get(boardId)?.values() ?? [])].some(
          (source) => source.replayPolicy === 'manual',
        )
      )
        return;
      this.#storage.boards.delete(boardId);
      this.#storage.retained.delete(boardId);
      this.#storage.generations.delete(boardId);
      this.#seen.delete(boardId);
    });
  }

  /** @inheritdoc */
  close(): void {
    this.#isClosed = true;
  }

  /**
   * What this connection has seen of a board, created empty on first use.
   *
   * @param boardId - The board.
   * @returns The seen records.
   */
  #seenOf(boardId: string): SeenRecords {
    let seen = this.#seen.get(boardId);
    if (seen === undefined) {
      seen = {
        generation: this.#storage.generations.get(boardId) ?? 0,
        snapshotVersion: undefined,
        updateKeys: new Set(),
      };
      this.#seen.set(boardId, seen);
    }
    return seen;
  }

  /**
   * Returns the active or retained records of a bound generation.
   *
   * @param boardId - The board.
   * @param generation - The bound generation.
   * @returns Mutable owned storage records.
   * @throws {Error} When a requested older generation is missing.
   */
  #board(boardId: string, generation: number): MemoryStoredBoard {
    if (generation === (this.#storage.generations.get(boardId) ?? 0))
      return this.#storage.board(boardId);
    const board = this.#storage.retained.get(boardId)?.get(generation);
    if (board === undefined) throw new Error('Cache generation is no longer available.');
    return board;
  }

  /**
   * Copies a generation without marking its records seen.
   *
   * @param boardId - The board.
   * @param generation - The requested generation.
   * @returns Independent bytes and record identities.
   */
  #capture(boardId: string, generation: number): CapturedRecovery {
    const board = this.#board(boardId, generation);
    return {
      ...(board.replayPolicy === undefined ? {} : { replayPolicy: board.replayPolicy }),
      generation,
      snapshotVersion: board.snapshot?.version,
      updateKeys: [...board.updates.keys()],
      board: {
        snapshot: board.snapshot?.bytes.slice(),
        updates: [...board.updates.values()].map((bytes) => bytes.slice()),
      },
    };
  }

  /**
   * Runs a request now, as a settled promise.
   *
   * @param request - The request.
   * @returns Its result, or a rejection with what it threw or with a closed-cache error.
   */
  #run<Result>(request: () => Result): Promise<Result> {
    if (this.#isClosed) return Promise.reject(new Error('The document cache is closed.'));
    // The executor turns anything `request` throws into the rejection.
    return new Promise((resolve) => {
      resolve(request());
    });
  }
}

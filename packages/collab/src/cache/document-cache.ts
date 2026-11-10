import type { SnapshotPreviewCache } from './snapshot-preview.js';
import type { SnapshotStamp } from './snapshot-stamp.js';

/** A board's content as a cache stores it: a snapshot, then the updates stored after it. */
export interface CachedBoard {
  /** The board's full state when it was last compacted (Yjs update format v1), if ever. */
  readonly snapshot: Uint8Array | undefined;
  /** Updates stored since, oldest first. */
  readonly updates: readonly Uint8Array[];
  /**
   * What was stored with the snapshot when it was compacted, if anything; a reader
   * trusts it only for the bytes its digest matches (`isTrustedStamp`).
   */
  readonly snapshotStamp?: SnapshotStamp;
}

/** One immutable capture of a cache generation, including exact persistence identities. */
export interface CapturedRecovery {
  /** Explicitly discarded generations remain exportable but must never replay automatically. */
  readonly replayPolicy?: 'manual';
  /** Generation zero is the original unpartitioned cache. */
  readonly generation: number;
  /** Snapshot identity used by compare-and-swap publication. */
  readonly snapshotVersion: number | undefined;
  /** Original bytes, never rewritten by recovery. */
  readonly board: CachedBoard;
  /** Update identities included in this capture. */
  readonly updateKeys: readonly number[];
}

/** Durable recovery generations; publication never deletes the previous source. */
export interface CacheRecoveryStorage {
  /**
   * Captures the connection's bound generation and original record identities.
   *
   * @param boardId - The board.
   * @returns A consistent capture.
   */
  capture(boardId: string): Promise<CapturedRecovery>;
  /**
   * Atomically retains the captured source and publishes a fresh active snapshot.
   * Only the successful publisher becomes bound to the new generation.
   *
   * @param boardId - The board.
   * @param captured - Exact source captured before candidate construction.
   * @param snapshot - Validated fresh candidate bytes.
   * @param replayPolicy - Retain the old generation for manual export only after explicit discard.
   * @returns False without mutation when the source changed or another publisher won.
   */
  publish(
    boardId: string,
    captured: CapturedRecovery,
    snapshot: Uint8Array,
    replayPolicy?: 'manual',
  ): Promise<boolean>;
  /**
   * Lists retained generations, including later writes from still-bound old connections.
   *
   * @param boardId - The board.
   * @returns Original retained records available for recovery or export.
   */
  retained(boardId: string): Promise<readonly CapturedRecovery[]>;
}

/** A board as a build writing an earlier stored layout cached it. */
export interface EarlierLayoutBoard {
  /** Retained manual sources are export-only, even when mixed with active snapshot bytes. */
  readonly replayPolicy?: 'manual';
  /**
   * Where the copy is kept (the IndexedDB database's name): it tells copies of one board apart,
   * so the person dismisses each one.
   */
  readonly source: string;
  /** The stored layout the build that cached it wrote (`DOCUMENT_LAYOUT_VERSION` then). */
  readonly layoutVersion: number;
  /** What that build cached: its snapshot and the updates after it. */
  readonly board: CachedBoard;
  /**
   * The keys of the update records read, so a delete removes only those: records another tab
   * (an old build still open) appends after the read stay for the next open.
   */
  readonly updateKeys: readonly number[];
  /** The version of the snapshot read; a delete keeps a snapshot written since. */
  readonly snapshotVersion: number | undefined;
  /**
   * Whether the copy is in the unsuffixed pre- database: a board's copy left
   * behind (a layout-1 stamp, or bytes it could not read). No converter carries it (the relay
   * refuses a layout-1 stamp as `invalid-stamp`, and whole-pair line edits would replay into
   * split fields), and it is deleted only when the person dismisses it.
   */
  readonly isPreLayoutCache: boolean;
  /** Original recovery sources must be proved in isolation and are never retired by carry-over. */
  readonly shouldRecover?: true;
}

/**
 * The copies of boards that builds writing earlier stored layouts left on the device:
 * a writer-layout-isolated cache never restores them, so whatever they hold that the relay
 * lacks (unsent offline edits, a board that only ever lived on the device) must be found,
 * carried over or reported, and deleted only once it is safe. Keyed like the cache it belongs
 * to.
 */
export interface EarlierLayoutCaches {
  /** The stored layout this build writes: where the earlier copies would be carried. */
  readonly writerLayoutVersion: number;
  /**
   * Reads a board from every earlier writer layout's storage that exists and holds it.
   *
   * @param boardId - The board.
   * @returns The copies, oldest first; empty when there are none.
   */
  find(boardId: string): Promise<readonly EarlierLayoutBoard[]>;
  /**
   * Deletes the records one copy was read from, and nothing else: not other boards, and not
   * records of this board stored after the read (the snapshot only while its version is the one
   * read).
   *
   * @param boardId - The board.
   * @param copy - The copy, as `find` returned it.
   * @returns Resolves once they are gone (at once when there were none).
   */
  delete(boardId: string, copy: EarlierLayoutBoard): Promise<void>;
}

/**
 * The client's local copy of boards: an update log per board,
 * compacted into a snapshot every so often, so a board opens from the device before the
 * network answers and edits made offline survive a reload. It stores opaque update bytes; the
 * binding (`DocumentCacheBinding`) moves them in and out of a `DocumentStore`.
 *
 * Persisted implementations must isolate writer layouts: old unsent update bytes must not
 * be restored by a build writing a different stored layout. IndexedDB namespaces
 * do this automatically; custom implementations must provide the same boundary.
 *
 * Several connections may share one storage (browser tabs on the same origin). Each connection
 * remembers which records it has written or read, so a compaction deletes only what its
 * snapshot covers and never replaces a snapshot it has not seen. Requests take effect in the
 * order they are made: an update appended before a compaction is requested is covered by it.
 */
export interface DocumentCache {
  /** Optional atomic display sidecars in this writer layout’s database only. */
  readonly snapshotPreview?: SnapshotPreviewCache;
  /** Atomic durable recovery; absent implementations leave an unreadable cache intact. */
  readonly recovery?: CacheRecoveryStorage;
  /**
   * The copies earlier writer layouts left of the same boards, under the same keys; absent for
   * a cache that never had an earlier layout (in memory, a test's).
   */
  readonly earlierLayouts?: EarlierLayoutCaches;
  /**
   * Reads everything stored for a board, and remembers it as seen by this connection.
   *
   * @param boardId - The board.
   * @returns The snapshot and the updates after it; empty for a board never stored.
   */
  load(boardId: string): Promise<CachedBoard>;
  /**
   * Reads a board's logged updates (those stored since its snapshot), oldest first, without
   * remembering them as seen, so a later compaction never deletes a record this connection only
   * read (the collab client replays them to send a large offline batch in transaction
   * order). Read-only; it never waits on or changes another request. Optional: a cache without
   * it makes the client split large updates by struct ranges instead.
   *
   * @param boardId - The board.
   * @returns The updates; empty for a board never stored or just compacted.
   */
  readUpdates?(boardId: string): Promise<readonly Uint8Array[]>;
  /**
   * Appends one update to a board's log.
   *
   * @param boardId - The board.
   * @param update - The update bytes; the cache keeps its own copy.
   * @returns Resolves once the update is stored.
   */
  append(boardId: string, update: Uint8Array): Promise<void>;
  /**
   * Replaces a board's snapshot with `snapshot` and deletes the updates it covers: every update
   * this connection appended or loaded before the call. Updates other connections stored that
   * this one has not seen stay in the log. Call it in the same task that encoded `snapshot`,
   * so the appends it covers are exactly the ones requested before it. The transaction only
   * writes and deletes: the caller encodes the snapshot beforehand, off the frame.
   * Ordinary compaction clears any prior snapshot preview atomically.
   *
   * @param boardId - The board.
   * @param snapshot - The caller's full state (Yjs update format v1).
   * @param stamp - Stored with the snapshot and returned by `load` beside it; absent,
   *   the snapshot has none.
   * @returns `true` once the snapshot is stored; `false`, with nothing changed, when another
   *   connection stored a snapshot this one has not loaded (load it, then compact again).
   */
  compact(boardId: string, snapshot: Uint8Array, stamp?: SnapshotStamp): Promise<boolean>;
  /**
   * Deletes a board without manual recovery generations. Manual sources and their replay
   * policy remain intact until a separate safe retirement policy exists.
   *
   * @param boardId - The board.
   * @returns Resolves once the board is gone.
   */
  delete(boardId: string): Promise<void>;
  /** Closes the connection; later requests reject. */
  close(): void;
}

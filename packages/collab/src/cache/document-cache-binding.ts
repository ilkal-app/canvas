import {
  assertUpdateDepth,
  StoreDestroyedError,
  waitForStoreIdle,
  type DocumentStore,
  type DocumentUpdate,
} from '@canvas/document';

import { reportAsynchronously } from '../errors/report-asynchronously.js';

import { isTrustedSnapshot, proveReadable, stampFor } from './cache-restore-trial.js';
import { restoreCached, restoreCachedInSteps } from './cache-restore.js';
import { CacheWriteTracker, type BoardCacheWrites } from './cache-write-tracker.js';
import type { CachedBoard, DocumentCache } from './document-cache.js';
import { createIdleScheduler, type IdleScheduler, type IdleTask } from './idle-scheduler.js';

/**
 * How many stored updates trigger a compaction by default: the log a board reopens from stays
 * short, and a compaction (one `encodeState`) runs rarely. y-indexeddb trims at the same size.
 */
export const DEFAULT_COMPACT_EVERY = 500;

/**
 * The longest a due compaction waits for an idle period, in ms. Past it the compaction runs
 * anyway, so a board that is never idle still gets its log compacted.
 */
export const DEFAULT_COMPACTION_IDLE_TIMEOUT_MS = 10_000;

/** What a {@link DocumentCacheBinding} connects. */
export interface DocumentCacheBindingOptions {
  /** The board's store; the binding restores into it and stores what changes in it. */
  readonly store: DocumentStore;
  /** Where the board is kept on the device. */
  readonly cache: DocumentCache;
  /** The board's id, its key in the cache. */
  readonly boardId: string;
  /** Compact after this many updates are stored since the last snapshot; default 500. */
  readonly compactEvery?: number;
  /**
   * Receives failed writes and compactions. The cache is a copy (the relay holds the board),
   * so a failure never stops editing. Default: rethrown from a microtask, where the host's
   * error reporting sees it.
   */
  readonly onError?: (error: unknown) => void;
  /**
   * Runs due compactions when the main thread is idle; default `requestIdleCallback` (a
   * zero-delay timeout where there is none). A compaction's `encodeState` is one long task
   * (about 75 ms at 10k objects, 400 ms at 50k; `compaction.bench.ts`), so it must not land
   * inside a frame.
   */
  readonly idleScheduler?: IdleScheduler;
  /** The longest a due compaction waits for idle time, in ms; default 10 000. */
  readonly idleTimeoutMs?: number;
  /**
   * Optionally prepares display-only bytes for the store's current state, after carry-over and
   * resource readiness. A store update while awaiting preparation discards these bytes. The
   * final snapshot encoding and sidecar compaction run in one task under the cache's CAS.
   * Failure is reported and ordinary compaction continues; unsupported caches never call it.
   */
  readonly prepareSnapshotPreview?: () => Promise<Uint8Array | undefined>;
  /**
   * Lets the browser run other tasks while `open` restores a large board: awaited
   * after the cache is read, after a trial, and between the snapshot and its tail, and handed to
   * a store's `applyUpdateInSteps` (`yieldToBrowser` in a page). Default: none, so the restore
   * runs to its end at once.
   */
  readonly yieldToBrowser?: () => Promise<void>;
}

/**
 * Keeps a board's store and its cached copy together (every client
 * keeps a local IndexedDB copy of the document). Opening restores the cached board into the
 * store in at most two transactions (the snapshot, then the updates after it), so the first
 * paint can use it before the network answers; from then on every update of the store, local
 * or from the relay, is appended to the cache. Every `compactEvery` updates a compaction is
 * due: at the next idle period the binding encodes the store's state and, in the same task,
 * asks the cache to store it as the snapshot and delete the updates it covers. When another tab
 * stored a newer snapshot first, the binding loads the board, applies it to the store and
 * compacts again, so no tab's edits are dropped. Works through the store's update bytes only;
 * it never touches the Yjs document.
 */
export class DocumentCacheBinding {
  /** Appends until committed; `holdNewWork` defers compactions, `workSettled` awaits. */
  readonly writes: BoardCacheWrites;
  readonly #writes = new CacheWriteTracker(
    () => {
      if (!this.#isDestroyed) this.resumeCompaction();
    },
    () => this.flush(),
  );
  readonly #store: DocumentStore;
  readonly #cache: DocumentCache;
  readonly #boardId: string;
  readonly #compactEvery: number;
  readonly #onError: (error: unknown) => void;
  readonly #idleScheduler: IdleScheduler;
  readonly #idleTimeoutMs: number;
  readonly #prepareSnapshotPreview: (() => Promise<Uint8Array | undefined>) | undefined;
  #revision = 0;
  #isDestroyed = false;
  readonly #pendingWrites = new Set<Promise<void>>();
  readonly #unsubscribe: () => void;
  #compaction: Promise<void> | undefined;
  #idleTask: IdleTask | undefined;
  #finishIdleWait: (() => void) | undefined;
  #isCompactionOwed = false;
  /** Whether `open` is still restoring: a compaction now could drop the tail not yet applied. */
  #isOpening = false;
  #isCompactionDeferred = false;
  #isCompactionHeld: () => boolean = () => false;
  #storedSinceSnapshot = 0;
  #isRestoring = false;

  /**
   * Starts storing the store's updates; {@link DocumentCacheBinding.open} restores first.
   *
   * @param options - The store, cache, board and policy.
   * @throws {RangeError} When `compactEvery` is not a positive integer.
   */
  private constructor(options: DocumentCacheBindingOptions) {
    this.#store = options.store;
    this.#cache = options.cache;
    this.#boardId = options.boardId;
    this.#compactEvery = options.compactEvery ?? DEFAULT_COMPACT_EVERY;
    this.#onError = options.onError ?? reportAsynchronously;
    this.#idleScheduler = options.idleScheduler ?? createIdleScheduler();
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_COMPACTION_IDLE_TIMEOUT_MS;
    this.#prepareSnapshotPreview = options.prepareSnapshotPreview;
    this.writes = this.#writes;
    if (!Number.isInteger(this.#compactEvery) || this.#compactEvery < 1) {
      throw new RangeError(
        `compactEvery is a positive integer; received ${String(this.#compactEvery)}.`,
      );
    }
    this.#unsubscribe = this.#store.subscribeUpdates(this.#onUpdate);
  }

  /**
   * Persists future store updates without restoring cached records. Recovery uses this only
   * after retaining its source separately and deciding to reconnect with a fresh store.
   *
   * @param options - The store, cache, board and policy.
   * @returns The attached binding.
   * @throws {RangeError} When `compactEvery` is not a positive integer.
   */
  static attach(options: DocumentCacheBindingOptions): DocumentCacheBinding {
    return new DocumentCacheBinding(options);
  }

  /**
   * Restores a cache only after an isolated read-only store proves its layout readable.
   *
   * @param options - Binding settings.
   * @returns The restored binding.
   */
  static async open(options: DocumentCacheBindingOptions): Promise<DocumentCacheBinding> {
    const binding = new DocumentCacheBinding(options);
    binding.#isOpening = true;
    try {
      const cached = await binding.#cache.load(binding.#boardId);
      // The tail is walked before anything merges it; the snapshot needs no walk here, since
      // every store apply walks its bytes before changing anything.
      for (const update of cached.updates) assertUpdateDepth(update);
      const yieldToBrowser = options.yieldToBrowser;
      await yieldToBrowser?.();
      // A snapshot stamped by a build that read it, for exactly these bytes, with no tail after
      // it, is applied once; anything else is proven readable in a trial store first,
      // so an unreadable cache never poisons the store. A tail always needs the trial: its
      // objects' writers may be stamped only in the snapshot's metadata.
      if (!isTrustedSnapshot(cached)) {
        proveReadable(options.store, cached);
        await yieldToBrowser?.();
      }
      // Not while a stepped run holds the store: its parts must meet no other writer.
      if (!(await waitForStoreIdle(options.store))) throw new StoreDestroyedError();
      if (yieldToBrowser === undefined) binding.#restore(cached);
      else await binding.#restoreInSteps(cached, yieldToBrowser);
      binding.#storedSinceSnapshot += cached.updates.length;
    } catch (error: unknown) {
      binding.destroy();
      throw error;
    }
    binding.#isOpening = false;
    // An update the store took between restore steps called for a compaction.
    if (binding.#isCompactionDeferred) binding.resumeCompaction();
    return binding;
  }

  /**
   * Waits for every write and compaction requested so far to settle.
   *
   * @returns Resolves once they have (failures go to `onError`).
   */
  async flush(): Promise<void> {
    await Promise.all([...this.#pendingWrites, this.#compaction]);
  }

  /**
   * Replaces the board's log with one snapshot of the store at the next idle period. A
   * compaction already due is reused.
   *
   * @returns Resolves once the compaction has settled (a failure goes to `onError`).
   */
  compact(): Promise<void> {
    this.#compaction ??= this.#runCompaction().finally(() => {
      this.#compaction = undefined;
      if (this.#isCompactionOwed) {
        this.#isCompactionOwed = false;
        void this.compact();
      }
    });
    return this.#compaction;
  }

  /**
   * Holds compactions while `isHeld` says so: a compaction folds the log into the
   * snapshot, and a log record the relay has not acknowledged must stay a record of its own, so
   * the next connection, after a reload too, can replay the unsent transactions whole. A
   * compaction due while held waits for {@link DocumentCacheBinding.resumeCompaction}; the log
   * grows meanwhile. The collab client holds compactions until it is connected with every local
   * update acknowledged; a store with no relay (a local board) is never held unless its owner
   * says so.
   *
   * @param isHeld - Whether compactions must wait now; read when one is about to run.
   */
  holdCompactionWhile(isHeld: () => boolean): void {
    this.#isCompactionHeld = isHeld;
  }

  /**
   * Runs a compaction that came due while held (or with a log long enough for one, as after a
   * reload), once compactions are no longer held.
   */
  resumeCompaction(): void {
    const isDue = this.#isCompactionDeferred || this.#storedSinceSnapshot >= this.#compactEvery;
    if (!isDue || this.#isCompactionHeld() || this.#writes.isNewWorkHeld) return;
    this.#isCompactionDeferred = false;
    void this.compact();
  }

  /** Stops storing updates and drops a compaction still waiting for idle time. */
  destroy(): void {
    this.#isDestroyed = true;
    this.#unsubscribe();
    this.#idleTask?.cancel();
    this.#finishIdleWait?.();
  }

  /**
   * Restores cached content (`restoreCached`), ignoring the store's updates meanwhile.
   *
   * @param content - A snapshot and updates, any of them absent.
   */
  #restore(content: CachedBoard): void {
    this.#isRestoring = true;
    try {
      restoreCached(this.#store, content);
    } finally {
      this.#isRestoring = false;
    }
  }

  /**
   * Restores cached content in browser tasks (`restoreCachedInSteps`), ignoring the store's
   * remote updates only during each apply of cached bytes: between them the store takes others,
   * which are stored like any.
   *
   * @param content - A snapshot and updates, any of them absent.
   * @param yieldToBrowser - Lets the browser run other tasks.
   * @returns Resolves once restored.
   */
  #restoreInSteps(content: CachedBoard, yieldToBrowser: () => Promise<void>): Promise<void> {
    return restoreCachedInSteps(this.#store, content, yieldToBrowser, async (apply) => {
      this.#isRestoring = true;
      try {
        await apply();
      } finally {
        this.#isRestoring = false;
      }
    });
  }

  /**
   * Waits for idle time, then compacts; never rejects.
   *
   * @returns Resolves once the compaction has settled, or at once after `destroy()`.
   */
  #runCompaction(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#finishIdleWait = resolve;
      this.#idleTask = this.#idleScheduler.schedule(() => {
        this.#idleTask = undefined;
        this.#finishIdleWait = undefined;
        resolve(this.#compactNow());
      }, this.#idleTimeoutMs);
    });
  }

  /**
   * Encodes the store and requests the compaction in the same task, so the updates the cache
   * deletes are exactly those the snapshot covers; while compactions are held, only marks one
   * as due. When another tab's snapshot is in the way,
   * loads the board into the store and owes another compaction.
   *
   * @returns Resolves once the compaction has settled; never rejects.
   */
  async #compactNow(): Promise<void> {
    if (this.#shouldSkipCompaction()) return;
    try {
      const revision = this.#revision;
      const sidecar = this.#cache.snapshotPreview;
      const preview =
        sidecar === undefined || this.#prepareSnapshotPreview === undefined
          ? undefined
          : await this.#preparePreview();
      if (this.#shouldSkipCompaction()) return;
      this.#storedSinceSnapshot = 0;
      // Never await between encoding and requesting compaction: an append in that gap could
      // otherwise be removed despite not being covered by these snapshot bytes.
      const snapshot = this.#store.encodeState();
      const stamp = stampFor(this.#store, snapshot);
      const isWritten = await (sidecar !== undefined &&
      preview !== undefined &&
      revision === this.#revision
        ? sidecar.compact(this.#boardId, snapshot, preview, stamp)
        : this.#cache.compact(this.#boardId, snapshot, stamp));
      if (!isWritten) {
        if (await this.#isRetainedGeneration()) return;
        const loaded = await this.#cache.load(this.#boardId);
        // Once no stepped run holds the store; nothing when destroyed meanwhile.
        if (!(await waitForStoreIdle(this.#store)) || this.#isDestroyed) return;
        this.#restore(loaded);
        this.#isCompactionOwed = true;
      }
    } catch (error: unknown) {
      this.#onError(error);
    }
  }

  /**
   * Rechecks lifecycle, an open still restoring, and acknowledgement holds, including after
   * awaited resource work.
   *
   * @returns Whether compaction must be skipped now.
   */
  #shouldSkipCompaction(): boolean {
    if (this.#isDestroyed) return true;
    if (!this.#isOpening && !this.#isCompactionHeld() && !this.#writes.isNewWorkHeld) return false;
    this.#isCompactionDeferred = true;
    return true;
  }

  /**
   * Prepares optional display bytes without letting a renderer failure lose a normal snapshot.
   *
   * @returns Prepared bytes, or undefined on refusal or failure.
   */
  async #preparePreview(): Promise<Uint8Array | undefined> {
    try {
      return await this.#prepareSnapshotPreview?.();
    } catch (error: unknown) {
      this.#onError(error);
      return undefined;
    }
  }

  /**
   * Detects a connection permanently fenced by another tab's recovery publication. Its old
   * source remains retained; loading it again would neither make compaction succeed nor be
   * safe to merge into an otherwise usable live store.
   *
   * @returns Whether this connection is bound to a retained generation.
   */
  async #isRetainedGeneration(): Promise<boolean> {
    const recovery = this.#cache.recovery;
    if (recovery === undefined) return false;
    const source = await recovery.capture(this.#boardId);
    const retained = await recovery.retained(this.#boardId);
    return retained.some(({ generation }) => generation === source.generation);
  }

  /**
   * Stores one update of the store, and compacts when the log is long enough.
   *
   * @param documentUpdate - The store's update.
   */
  readonly #onUpdate = (documentUpdate: DocumentUpdate): void => {
    this.#revision += 1;
    // What a restore applies is already cached; what the store writes in response (its
    // reference repair; Yjs's formatting clean-up) is new, and is stored like any edit.
    if (this.#isRestoring && !documentUpdate.isLocal) return;
    const append = this.#cache.append(this.#boardId, documentUpdate.update);
    const write = this.#writes.track(append).catch(this.#onError);
    this.#pendingWrites.add(write);
    void write.finally(() => this.#pendingWrites.delete(write));
    this.#storedSinceSnapshot += 1;
    if (this.#storedSinceSnapshot >= this.#compactEvery) void this.compact();
  };
}

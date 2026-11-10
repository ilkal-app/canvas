import { reportAsynchronously } from '../errors/report-asynchronously.js';

/**
 * The writes a board cache has been asked for and not yet finished, and a way to keep
 * it from starting optional work while the page may be going away. A write is pending from the
 * moment it is requested until its IndexedDB transaction completes or aborts (a request error
 * aborts its transaction: nothing here prevents that default). A page reloaded in between loses
 * that write, so the shell holds the reload while one is pending (`beforeunload`). Only the
 * appends of edits count: a compaction cut off in flight loses nothing, because its transaction
 * is atomic and the log it would have folded stays. Main thread or worker.
 */
export interface BoardCacheWrites {
  /** Whether a write requested of the cache has neither committed nor failed yet. */
  readonly isPending: boolean;
  /**
   * Calls `listener` whenever {@link BoardCacheWrites.isPending} changes: once when the first
   * write is requested after an idle spell, once when the last of them settles. Synchronous
   * with the request, so a listener sees the cache busy before the edit's task ends.
   *
   * @param listener - Called with no arguments; read `isPending`.
   * @returns A function that stops listening.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Waits until no write is pending, including writes requested while waiting.
   *
   * @returns Resolves once the cache is idle (failed writes count as settled).
   */
  settled(): Promise<void>;
  /**
   * Keeps the cache from starting optional work (a compaction, with its snapshot encoding and
   * preview) until released, for a page that is being hidden or unloaded: such work could be
   * cut off by the page going away and would only delay the writes that matter. Edits are still
   * stored. Holds are counted; a compaction that came due meanwhile runs once the last one is
   * released.
   *
   * @returns The release; calling it twice releases once.
   */
  holdNewWork(): () => void;
  /**
   * Waits until every write and compaction (with its snapshot and the board's cached preview)
   * requested so far has settled, a due compaction's wait for idle time included (work
   * that can wait, such as drawing a board's thumbnail, waits for it). Absent from a cache with
   * no compactions.
   *
   * @returns Resolves once the cache has nothing in flight.
   */
  workSettled?(): Promise<void>;
}

/**
 * Counts a cache's pending writes and its new-work holds ({@link BoardCacheWrites}); the
 * `DocumentCacheBinding` tracks each append through it.
 */
export class CacheWriteTracker implements BoardCacheWrites {
  readonly #pending = new Set<Promise<unknown>>();
  readonly #listeners = new Set<() => void>();
  readonly #onNewWorkReleased: () => void;
  #idleWaiters: (() => void)[] = [];
  #holdCount = 0;
  readonly #workSettled: (() => Promise<void>) | undefined;

  /**
   * Starts idle, with no hold.
   *
   * @param onNewWorkReleased - Called when the last {@link CacheWriteTracker.holdNewWork} hold
   *   is released, so work deferred meanwhile can start.
   * @param workSettled - Waits for the owner's compactions as well as the writes
   *   ({@link BoardCacheWrites.workSettled}); the writes alone if absent.
   */
  constructor(onNewWorkReleased: () => void = () => undefined, workSettled?: () => Promise<void>) {
    this.#onNewWorkReleased = onNewWorkReleased;
    this.#workSettled = workSettled;
  }

  /** @inheritdoc */
  workSettled(): Promise<void> {
    return this.#workSettled?.() ?? this.settled();
  }

  /** @inheritdoc */
  get isPending(): boolean {
    return this.#pending.size > 0;
  }

  /**
   * Whether a {@link CacheWriteTracker.holdNewWork} hold is in place.
   *
   * @returns True while at least one hold is unreleased.
   */
  get isNewWorkHeld(): boolean {
    return this.#holdCount > 0;
  }

  /**
   * Counts `write` as pending until it settles, either way.
   *
   * @param write - The write's promise: it settles when its transaction completes or aborts.
   * @returns `write` itself, so a caller can chain on it.
   */
  track<Result>(write: Promise<Result>): Promise<Result> {
    const wasPending = this.isPending;
    this.#pending.add(write);
    const settle = (): void => {
      this.#pending.delete(write);
      if (this.isPending) return;
      for (const resolve of this.#idleWaiters.splice(0)) resolve();
      this.#notify();
    };
    write.then(settle, settle);
    if (!wasPending) this.#notify();
    return write;
  }

  /** @inheritdoc */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** @inheritdoc */
  settled(): Promise<void> {
    if (!this.isPending) return Promise.resolve();
    return new Promise((resolve) => {
      this.#idleWaiters.push(resolve);
    });
  }

  /** @inheritdoc */
  holdNewWork(): () => void {
    this.#holdCount += 1;
    let isReleased = false;
    return () => {
      if (isReleased) return;
      isReleased = true;
      this.#holdCount -= 1;
      if (this.#holdCount === 0) this.#onNewWorkReleased();
    };
  }

  /** Tells every listener that `isPending` changed; a throwing listener stops none of the rest. */
  #notify(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch (error: unknown) {
        reportAsynchronously(error);
      }
    }
  }
}

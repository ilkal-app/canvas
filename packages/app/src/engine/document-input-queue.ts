import { isStoreRunning, waitForStoreIdle, type DocumentStore } from '@canvas/document';

/** One piece of the person's input that would write (`DocumentInputQueue`). */
export interface InputEntry {
  /**
   * Checks, at replay, that what the input captured still holds (its page, selection and
   * targets).
   *
   * @returns Why it no longer holds, a notice for the person; `undefined` to run it.
   */
  check(): string | undefined;
  /** Acts on the input. */
  run(): void;
}

/** What `DocumentInputQueue` needs. */
export interface DocumentInputQueueOptions {
  /** The document the input writes. */
  readonly store: DocumentStore;
  /**
   * Shows the person a notice: why a waiting input was dropped.
   *
   * @param message - The notice.
   */
  onNotice(message: string): void;
}

/**
 * The person's input that would write the document, in one order: run at once
 * while no stepped run holds the store and nothing waits; else queued, in arrival order, and
 * replayed once the store is idle, each entry checked first (`InputEntry.check`) and dropped with
 * its notice when what it captured no longer holds. An entry whose run opens a new run pauses the
 * replay until that one ends. Input made from inside an entry's own run is part of it, and runs
 * at once. Main thread.
 */
export class DocumentInputQueue {
  readonly #options: DocumentInputQueueOptions;
  #waiting: InputEntry[] = [];
  #isReplayScheduled = false;
  /** How deep inside entries' runs the queue is: input made there runs at once. */
  #depth = 0;

  /**
   * Makes the queue.
   *
   * @param options - The store and where notices go.
   */
  constructor(options: DocumentInputQueueOptions) {
    this.#options = options;
  }

  /**
   * Whether input waits.
   *
   * @returns `true` while any entry is queued.
   */
  get isHolding(): boolean {
    return this.#waiting.length > 0;
  }

  /**
   * Runs an input now, when no run holds the store and nothing waits (or from inside another
   * entry's run); else queues it behind what waits.
   *
   * @param entry - The input.
   */
  run(entry: InputEntry): void {
    if (this.#depth > 0 || (this.#waiting.length === 0 && !isStoreRunning(this.#options.store))) {
      this.#runEntry(entry);
      return;
    }
    this.#waiting.push(entry);
    this.#scheduleReplay();
  }

  /** Forgets what waits, unrun: the person can no longer edit, or the board is going. */
  drop(): void {
    this.#waiting = [];
  }

  /**
   * Runs an entry, counting the depth so input made inside it joins it.
   *
   * @param entry - The input.
   */
  #runEntry(entry: InputEntry): void {
    this.#depth += 1;
    try {
      entry.run();
    } finally {
      this.#depth -= 1;
    }
  }

  /** Replays once the store is idle; nothing when the store is destroyed first. */
  #scheduleReplay(): void {
    if (this.#isReplayScheduled) return;
    this.#isReplayScheduled = true;
    void waitForStoreIdle(this.#options.store).then((isIdle) => {
      this.#isReplayScheduled = false;
      if (isIdle) this.#replay();
      else this.drop();
    });
  }

  /** Replays what waits, in order, until it is done or an entry opens a run. */
  #replay(): void {
    for (let entry = this.#waiting.shift(); entry !== undefined; entry = this.#waiting.shift()) {
      const notice = entry.check();
      if (notice === undefined) this.#runEntry(entry);
      else this.#options.onNotice(notice);
      if (isStoreRunning(this.#options.store)) {
        this.#scheduleReplay();
        return;
      }
    }
  }
}

import type { DocumentStore, RunStopReason } from '@canvas/document';

// The inbound hold: while a stepped run holds the store (a large paste, delete or
// undo applied a part per browser task), the relay's document bytes are not applied, so the run's
// later parts never meet a board its plan did not see, and nothing throws `StoreBusyError` in the
// socket handler. They wait, in arrival order, with anything else that must touch the store (the
// handshake's state vector), and are applied once the store is idle, with the bookkeeping they
// carry. Presence, keepalives and acknowledgements of this client's own updates are not held.

/** The most inbound bytes held for a run; past it, the run is asked to stop (`inbound-backlog`). */
export const MAX_HELD_INBOUND_BYTES = 8 * 1024 * 1024;

/** A store's runs, as far as the hold reads them (`RunnableStore`). */
interface StoreRuns {
  readonly isRunning: boolean;
  whenIdle(): Promise<void>;
  requestStop(reason: RunStopReason): void;
}

/**
 * A store's runs, when it can hold one (`YjsDocumentStore`); `undefined` for any other store,
 * which nothing holds.
 *
 * @param store - The store.
 * @returns Its runs, or `undefined`.
 */
export function storeRunsOf(store: DocumentStore): StoreRuns | undefined {
  const runs = store as Partial<StoreRuns>;
  return typeof runs.whenIdle === 'function' && typeof runs.requestStop === 'function'
    ? (store as unknown as StoreRuns)
    : undefined;
}

/**
 * Does `work` now when no run holds the store, else once it is idle; nothing if the store is
 * destroyed first.
 *
 * @param store - The store.
 * @param work - What writes to it.
 */
export function whenWritable(store: DocumentStore, work: () => void): void {
  const runs = storeRunsOf(store);
  if (runs?.isRunning !== true) {
    work();
    return;
  }
  runs.whenIdle().then(
    () => {
      whenWritable(store, work);
    },
    () => undefined,
  );
}

/** One thing held: a relayed update with its bookkeeping, or an action on the store. */
type Held =
  | { readonly kind: 'frame'; readonly update: Uint8Array; readonly isStepTwo: boolean }
  | { readonly kind: 'action'; readonly run: () => void };

/** What applies what the hold releases. */
export interface InboundHoldHost {
  /**
   * Applies a relayed update with its receive bookkeeping, as an immediate frame would be.
   *
   * @param update - The update bytes.
   * @param isStepTwo - Whether it is the relay's sync step 2.
   */
  readonly apply: (update: Uint8Array, isStepTwo: boolean) => void;
  /**
   * A released update or action threw: the connection is dropped, as for a frame it cannot handle.
   *
   * @param error - The failure.
   */
  readonly onError: (error: unknown) => void;
  /**
   * Asks the relay again for everything the store lacks (a sync step 1 from the live state
   * vector): after an overflow, which dropped held updates. Absent, nothing is asked.
   */
  readonly resync?: () => void;
  /**
   * An overflow dropped sync step 2 frames, held or arriving after it: answers to step 1 requests
   * that were received but will not be applied.
   *
   * @param count - How many.
   */
  readonly onDroppedStepTwos?: (count: number) => void;
}

/** One connection's held inbound updates and store actions. */
export class InboundHold {
  readonly #runs: StoreRuns | undefined;
  readonly #host: InboundHoldHost;
  #held: Held[] = [];
  #bytes = 0;
  /** Past the bound: what arrives is dropped until a resync once the store is idle. */
  #isOverflowed = false;
  #isWaiting = false;
  #isDisposed = false;

  /**
   * Makes the hold of one connection.
   *
   * @param store - The connection's store.
   * @param host - What applies what is released.
   */
  constructor(store: DocumentStore, host: InboundHoldHost) {
    this.#runs = storeRunsOf(store);
    this.#host = host;
  }

  /**
   * Whether anything is held.
   *
   * @returns `true` until everything held was applied.
   */
  get isHolding(): boolean {
    return this.#held.length > 0;
  }

  /**
   * Whether what arrives now must wait: a run holds the store, or something earlier still waits.
   *
   * @returns `true` to hold it.
   */
  get shouldWait(): boolean {
    return this.#held.length > 0 || this.#isOverflowed || this.#runs?.isRunning === true;
  }

  /**
   * Whether held updates were dropped past the bound, so the store lacks some until the resync.
   *
   * @returns `true` from the overflow until the resync is asked for.
   */
  get isOverflowed(): boolean {
    return this.#isOverflowed;
  }

  /**
   * Holds a relayed update; past {@link MAX_HELD_INBOUND_BYTES}, asks the run to stop.
   *
   * @param update - The update bytes.
   * @param isStepTwo - Whether it is the relay's sync step 2.
   */
  holdUpdate(update: Uint8Array, isStepTwo: boolean): void {
    // Past the bound nothing more is kept: the resync brings it all back.
    if (this.#isOverflowed) {
      if (isStepTwo) this.#host.onDroppedStepTwos?.(1);
    } else {
      this.#held.push({ kind: 'frame', update, isStepTwo });
      this.#bytes += update.byteLength;
      if (this.#bytes > MAX_HELD_INBOUND_BYTES) this.#overflow();
    }
    this.#waitForIdle();
  }

  /** Drops every held update, keeps the held actions, and asks the run to stop. */
  #overflow(): void {
    this.#isOverflowed = true;
    const stepTwos = this.#held.filter((held) => held.kind === 'frame' && held.isStepTwo).length;
    this.#held = this.#held.filter((held) => held.kind === 'action');
    if (stepTwos > 0) this.#host.onDroppedStepTwos?.(stepTwos);
    this.#bytes = 0;
    this.#runs?.requestStop('inbound-backlog');
  }

  /**
   * Holds an action on the store, after everything held before it.
   *
   * @param run - The action.
   */
  holdAction(run: () => void): void {
    this.#held.push({ kind: 'action', run });
    this.#waitForIdle();
  }

  /**
   * Asks the open run to stop before its next part.
   *
   * @param reason - Why.
   */
  requestStop(reason: RunStopReason): void {
    this.#runs?.requestStop(reason);
  }

  /** Drops everything held: the connection is gone, and the next one resyncs. */
  dispose(): void {
    this.#isDisposed = true;
    this.#held = [];
    this.#bytes = 0;
    this.#isOverflowed = false;
  }

  /** Releases what is held once the store is idle; again if a run began in the meantime. */
  #waitForIdle(): void {
    const runs = this.#runs;
    if (this.#isWaiting || runs === undefined) return;
    this.#isWaiting = true;
    runs.whenIdle().then(
      () => {
        this.#isWaiting = false;
        if (this.#isDisposed) return;
        if (runs.isRunning) this.#waitForIdle();
        else this.#release();
      },
      // Destroyed: nothing is applied.
      () => {
        this.#isWaiting = false;
        this.dispose();
      },
    );
  }

  /**
   * Applies everything held, in order, then resyncs after an overflow. It waits again when what
   * it applied began a run (a listener's own large command); a failure drops the rest with the
   * connection.
   */
  #release(): void {
    while (!this.#isDisposed) {
      if (this.#runs?.isRunning === true) {
        this.#waitForIdle();
        return;
      }
      const next = this.#held.shift();
      if (next === undefined) break;
      if (next.kind === 'frame') this.#bytes -= next.update.byteLength;
      try {
        if (next.kind === 'frame') this.#host.apply(next.update, next.isStepTwo);
        else next.run();
      } catch (error: unknown) {
        this.dispose();
        this.#host.onError(error);
      }
    }
    if (this.#isDisposed || !this.#isOverflowed) return;
    this.#isOverflowed = false;
    this.#host.resync?.();
  }
}

import type { CollabStatusHolder } from './collab-status-holder.js';

/**
 * How long a client's first sync spent in each phase, in milliseconds from
 * consecutive monotonic marks (`performance.now()`), so the three add up to the time from the
 * socket's request to the first sync. They describe the connection that completed the client's
 * first sync; earlier attempts that failed, and the backoff between them, are in none of them.
 */
export interface SyncTimings {
  /**
   * From the moment the client asks for the socket to the relay's `authenticated`: the
   * WebSocket's connection (TCP, TLS, the HTTP upgrade), the auth message's way to the relay,
   * the relay's token check and whatever it does before answering, and the answer's way back.
   */
  readonly authMs: number;
  /**
   * From `authenticated` until the relay's sync step 2 arrives: the client's state vector going
   * out, the relay encoding what the client lacks, and those bytes' transfer.
   */
  readonly receiveMs: number;
  /**
   * From the relay's step 2 arriving until the client is synced (connected, with no local update
   * pending), the moment a headless client's `whenSynced()` resolves: decoding and applying the
   * step 2 to the store, plus any wait for the relay to acknowledge local updates.
   */
  readonly applyMs: number;
}

/**
 * Records the marks of a client's first sync. Each attempt starts the marks afresh
 * until one completes the sync; the timings are then fixed for the client's lifetime.
 * Package-private.
 */
export class SyncTimer {
  #requestedAt: number | undefined;
  #authenticatedAt: number | undefined;
  #stepTwoAt: number | undefined;
  #timings: SyncTimings | undefined;

  /**
   * The first sync's phases.
   *
   * @returns The timings, or `undefined` before the first sync.
   */
  get timings(): SyncTimings | undefined {
    return this.#timings;
  }

  /** A connection attempt asks for its socket: the marks start afresh. */
  markSocketRequested(): void {
    if (this.#timings !== undefined) return;
    this.#requestedAt = performance.now();
    this.#authenticatedAt = undefined;
    this.#stepTwoAt = undefined;
  }

  /** The relay accepted the attempt's token; only the first acceptance counts. */
  markAuthenticated(): void {
    if (this.#timings !== undefined || this.#requestedAt === undefined) return;
    this.#authenticatedAt ??= performance.now();
  }

  /** The relay's sync step 2 arrived, before it is applied; only the first counts. */
  markStepTwo(): void {
    if (this.#timings !== undefined || this.#authenticatedAt === undefined) return;
    this.#stepTwoAt ??= performance.now();
  }

  /**
   * Marks the sync at the first status that is synced as `whenSynced()` reads it (connected, no
   * local update pending). Subscribe before whoever waits for the sync, so the mark comes first.
   *
   * It stops watching by itself once the timings are fixed.
   *
   * @param status - The client's status.
   * @returns Stops watching.
   */
  markSyncedOn(status: CollabStatusHolder): () => void {
    const stop = status.subscribe(({ state, pendingUpdateCount }) => {
      if (state === 'connected' && pendingUpdateCount === 0) this.markSynced();
      if (this.#timings !== undefined) stop();
    });
    return stop;
  }

  /** The client is synced: fixes the timings, once the step 2 has arrived. */
  markSynced(): void {
    const requestedAt = this.#requestedAt;
    const authenticatedAt = this.#authenticatedAt;
    const stepTwoAt = this.#stepTwoAt;
    if (
      this.#timings !== undefined ||
      requestedAt === undefined ||
      authenticatedAt === undefined ||
      stepTwoAt === undefined
    ) {
      return;
    }
    this.#timings = Object.freeze({
      authMs: authenticatedAt - requestedAt,
      receiveMs: stepTwoAt - authenticatedAt,
      applyMs: performance.now() - stepTwoAt,
    });
  }
}

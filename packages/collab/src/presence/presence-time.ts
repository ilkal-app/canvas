/** Reads the current time for presence, in ms. Injected so tests run on a frozen clock. */
export interface PresenceClock {
  /**
   * The current time.
   *
   * @returns Milliseconds on a monotonic-enough clock (the default is `Date.now`).
   */
  now(): number;
}

/** A scheduled callback that has not run yet. */
export interface PresenceTimer {
  /** Stops the callback from running; does nothing once it has run. */
  cancel(): void;
}

/** Runs presence work later: outbound flushes, inbound flushes and timeout sweeps. */
export interface PresenceScheduler {
  /**
   * Runs `callback` once, after at least `delayMs`.
   *
   * @param callback - The work to run.
   * @param delayMs - The delay, in ms; 0 means "after the current task".
   * @returns A handle that cancels the callback.
   */
  schedule(callback: () => void, delayMs: number): PresenceTimer;
}

/** The wall clock: `Date.now()`. */
export const systemPresenceClock: PresenceClock = Object.freeze({ now: () => Date.now() });

/**
 * A scheduler over `setTimeout`, which exists on the main thread, in workers and in Node, so
 * headless agent clients get presence without a DOM.
 */
export const timeoutPresenceScheduler: PresenceScheduler = Object.freeze({
  schedule(callback: () => void, delayMs: number): PresenceTimer {
    const handle = setTimeout(callback, delayMs);
    return {
      cancel: () => {
        clearTimeout(handle);
      },
    };
  },
});

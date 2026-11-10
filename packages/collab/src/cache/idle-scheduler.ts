/** A pending idle callback. */
export interface IdleTask {
  /** Stops the callback from running; does nothing once it has run. */
  cancel(): void;
}

/**
 * Runs work when the main thread is idle, so a long task (a compaction's `encodeState`) lands
 * between frames rather than inside one. Injected so tests control when it runs.
 */
export interface IdleScheduler {
  /**
   * Runs `callback` once, at the next idle period, or after `timeoutMs` at the latest.
   *
   * @param callback - The work to run.
   * @param timeoutMs - The longest the work may wait, in ms.
   * @returns A handle that cancels the callback.
   */
  schedule(callback: () => void, timeoutMs: number): IdleTask;
}

/** The parts of `window` the default idle scheduler reads; absent in Node. */
export interface IdleSchedulerHost {
  /** The browser's idle callback. */
  requestIdleCallback?: (callback: () => void, options: { timeout: number }) => number;
  /** Cancels an idle callback. */
  cancelIdleCallback?: (handle: number) => void;
}

/**
 * Creates an {@link IdleScheduler} over `requestIdleCallback` with a timeout, where the host
 * has it (Chrome, Firefox, Safari 18+ in windows and workers). Elsewhere (Node, older Safari)
 * the work runs from a `setTimeout` of 0: after the current task, but with no idle guarantee.
 *
 * @param host - Where to find `requestIdleCallback`; default `globalThis`.
 * @returns The scheduler.
 */
export function createIdleScheduler(host: IdleSchedulerHost = globalThis): IdleScheduler {
  const { requestIdleCallback, cancelIdleCallback } = host;
  if (requestIdleCallback === undefined || cancelIdleCallback === undefined) {
    return {
      schedule(callback) {
        const handle = setTimeout(callback, 0);
        return {
          cancel: () => {
            clearTimeout(handle);
          },
        };
      },
    };
  }
  return {
    schedule(callback, timeoutMs) {
      const handle = requestIdleCallback.call(host, callback, { timeout: timeoutMs });
      return {
        cancel: () => {
          cancelIdleCallback.call(host, handle);
        },
      };
    },
  };
}

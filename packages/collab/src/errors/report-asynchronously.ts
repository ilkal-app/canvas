/**
 * Rethrows an error from a microtask, outside the current call stack, where the host's error
 * reporting (`window.onerror`, `process.on('uncaughtException')`) sees it. The default for
 * failures that must not stop the caller: a cache write, a relay frame that cannot be read, a
 * throwing status listener. Libraries never log (engineering standards).
 *
 * @param error - The error.
 */
export function reportAsynchronously(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}

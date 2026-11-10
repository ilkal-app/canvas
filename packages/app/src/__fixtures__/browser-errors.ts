// jsdom has no reportError. Preserve browser error events (and Vitest's unhandled-error
// detection), rather than installing a no-op that would hide genuine startup failures.
if (typeof window !== 'undefined' && typeof globalThis.reportError === 'undefined') {
  Object.defineProperty(globalThis, 'reportError', {
    configurable: true,
    writable: true,
    value: (error: unknown): void => {
      window.dispatchEvent(
        new ErrorEvent('error', {
          error,
          message: error instanceof Error ? error.message : String(error),
          cancelable: true,
        }),
      );
    },
  });
}

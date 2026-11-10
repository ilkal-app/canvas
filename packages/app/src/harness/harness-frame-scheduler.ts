import type { BrowserHostPlatform } from '@canvas/engine';

type Scheduler = Pick<
  BrowserHostPlatform,
  'now' | 'requestAnimationFrame' | 'cancelAnimationFrame'
>;

/** The harness's main-host frame queue, explicitly drawable without advancing its clock. */
export class HarnessFrameScheduler implements Scheduler {
  private isFlushing = false;
  private readonly pending = new Map<number, (timeMs: number) => void>();
  /**
   * Wraps the real scheduler; ordinary frames retain its behavior.
   *
   * @param scheduler - The page's frame scheduler.
   */
  constructor(private readonly scheduler: Scheduler) {}

  /**
   * Returns the underlying clock time without advancing it.
   *
   * @returns The current time in milliseconds.
   */
  now(): number {
    return this.scheduler.now();
  }

  /**
   * Queues a callback for a normal frame or the next explicit harness flush.
   *
   * @param callback - Receives the frame time in milliseconds.
   * @returns The underlying scheduler's cancellable handle.
   */
  requestAnimationFrame(callback: (timeMs: number) => void): number {
    const handle = this.scheduler.requestAnimationFrame((timeMs) => {
      if (!this.pending.delete(handle)) return;
      callback(timeMs);
    });
    this.pending.set(handle, callback);
    return handle;
  }

  /**
   * Cancels a callback in both the harness queue and the underlying scheduler.
   *
   * @param handle - The handle returned by requestAnimationFrame.
   */
  cancelAnimationFrame(handle: number): void {
    this.pending.delete(handle);
    this.scheduler.cancelAnimationFrame(handle);
  }

  /** Draws only the currently pending batch, at the current clock time. */
  flush(): void {
    if (this.isFlushing) return;
    this.isFlushing = true;
    try {
      const batch = [...this.pending];
      const now = this.scheduler.now();
      for (const [handle, callback] of batch) {
        if (!this.pending.delete(handle)) continue;
        this.scheduler.cancelAnimationFrame(handle);
        callback(now);
      }
    } finally {
      this.isFlushing = false;
    }
  }
}

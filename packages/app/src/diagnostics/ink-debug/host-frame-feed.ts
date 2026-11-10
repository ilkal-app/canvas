import type { EngineFrameReport, EngineHost } from '@canvas/engine';

/** One engine frame as the page received it, with where the engine runs and what it draws with. */
export interface HostFrame {
  /** The frame's report. */
  readonly report: EngineFrameReport;
  /** Where the engine runs: `worker` or `main`. */
  readonly hostKind: EngineHost['kind'];
  /** The GPU backend it draws with. */
  readonly backendName: EngineHost['capabilities']['backendName'];
  /** When the page received the report, ms on the page's clock. */
  readonly receivedMs: number;
}

/**
 * The engine's frame reports for the ink latency readout (`?inkdebug=1`), handed on to
 * whoever listens; with no listener it does nothing but one empty check per frame. Main thread.
 */
export class HostFrameFeed {
  private readonly listeners = new Set<(frame: HostFrame) => void>();

  /**
   * Hands one frame report on, when anyone listens.
   *
   * @param report - The report.
   * @param host - The host that drew it.
   * @param receivedMs - When the page received it, ms; `performance.now()` if absent.
   */
  follow(
    report: EngineFrameReport,
    host: Pick<EngineHost, 'kind' | 'capabilities'>,
    receivedMs?: number,
  ): void {
    if (this.listeners.size === 0) return;
    const frame: HostFrame = {
      report,
      hostKind: host.kind,
      backendName: host.capabilities.backendName,
      receivedMs: receivedMs ?? performance.now(),
    };
    for (const listener of [...this.listeners]) listener(frame);
  }

  /**
   * Listens to the frames from now on.
   *
   * @param listener - Receives each frame.
   * @returns A function that stops listening.
   */
  subscribe(listener: (frame: HostFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

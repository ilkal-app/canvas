import type { EngineFrameReport, EngineHost, EngineInputsCompleted } from '@canvas/engine';

import type { InputCompletion, TransferTiming } from './page-latency.js';

/** How many completions the recorder keeps. */
const KEPT_COMPLETIONS = 1_000;

/**
 * Records completed input marks from a host that reports them: one entry per mark, the last
 * thousand kept. Main thread.
 */
export class InputCompletions {
  private completions: InputCompletion[] = [];
  private readonly stopListening: () => void;

  /**
   * Starts recording.
   *
   * @param host - The running engine; one without `onInputsCompleted` records nothing.
   */
  constructor(host: EngineHost) {
    this.stopListening =
      host.onInputsCompleted?.((completion) => {
        this.record(completion, performance.now());
      }) ?? (() => undefined);
  }

  /**
   * The completions the page heard of at or after a time.
   *
   * @param sinceMs - The time, ms on the page's clock.
   * @returns One entry per mark, oldest first.
   */
  since(sinceMs: number): InputCompletion[] {
    return this.completions.filter(({ receivedMs }) => receivedMs >= sinceMs);
  }

  /** Stops recording. */
  stop(): void {
    this.stopListening();
  }

  private record(completion: EngineInputsCompleted, receivedMs: number): void {
    const { frameTimeMs, hasPendingWork, completedMs } = completion;
    for (const mark of completion.marks) {
      // The live ink overlay's hand-off mark is not a measured input.
      if (mark.kind === 'ink-handoff') continue;
      this.completions.push({
        kind: mark.kind,
        latencyMs: completedMs - mark.timestampMs,
        frameTimeMs,
        receivedMs,
        hasPendingWork,
      });
    }
    if (this.completions.length > KEPT_COMPLETIONS)
      this.completions = this.completions.slice(-KEPT_COMPLETIONS);
  }
}

/**
 * The transfer timings of the frames that began at or after a time.
 *
 * @param frames - Frame reports, oldest first.
 * @param sinceMs - The time, ms on the page's clock.
 * @returns One entry per frame that carried timings, oldest first.
 */
export function transferTimingsSince(
  frames: readonly EngineFrameReport[],
  sinceMs: number,
): TransferTiming[] {
  return frames.flatMap(({ frameTimeMs, transferMs }) =>
    transferMs === undefined || frameTimeMs < sinceMs
      ? []
      : [
          {
            frameTimeMs,
            pageToWorkerMs: transferMs.pageToWorker,
            workerToPageMs: transferMs.workerToPage,
          },
        ],
  );
}

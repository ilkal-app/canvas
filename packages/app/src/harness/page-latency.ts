// What the engine harness reports about the page's latency, as plain data.
import type { InputMarkKind } from '@canvas/engine';

/** A task that held the page's main thread for 50 ms or more (`PerformanceObserver` `longtask`). */
export interface PageLongTask {
  /** When it began, ms on the page's clock. */
  readonly startMs: number;
  /** How long it ran, ms. */
  readonly durationMs: number;
}

/** One input mark's latency to GPU completion, as the benchmark reads it. */
export interface InputCompletion {
  /** Which input it was. */
  readonly kind: InputMarkKind;
  /** From the input event to the GPU finishing the frame that took it, ms (not presentation). */
  readonly latencyMs: number;
  /** When that frame began, ms on the page's clock. */
  readonly frameTimeMs: number;
  /** When the page heard of the completion, ms on the page's clock. */
  readonly receivedMs: number;
  /** Whether the frame left work a later frame will show: the input was only partly drawn. */
  readonly hasPendingWork: boolean;
}

/** The two thread hops of one frame (transfer timers), as the benchmark reads them. */
export interface TransferTiming {
  /** When the frame began, ms on the page's clock. */
  readonly frameTimeMs: number;
  /** From the page posting the last batch before the frame to the worker receiving it, ms. */
  readonly pageToWorkerMs: number;
  /** From the worker posting the frame's report to the page receiving it, ms. */
  readonly workerToPageMs: number;
}

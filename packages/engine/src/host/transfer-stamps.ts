import type { EngineTransferTimings } from './engine-host.js';
import { hasFields, isNumber, type Check } from './host-protocol-checks.js';

/** The clock stamps of one page-to-worker batch and the frame report that followed it. */
export interface EngineTransferStamps {
  /** When the page posted the batch, ms on the page's clock. */
  readonly postedMs: number;
  /** When the worker received it, ms on the worker's clock. */
  readonly receivedMs: number;
  /** When the worker posted the frame report, ms on the worker's clock. */
  readonly sentMs: number;
}

/**
 * Checks for a frame report's transfer stamps.
 *
 * @param value - The received value.
 * @returns Whether it is one.
 */
export const isTransferStamps: Check = (value) =>
  hasFields(value, { postedMs: isNumber, receivedMs: isNumber, sentMs: isNumber });

/**
 * Converts a frame's transfer stamps to the two thread hops, ms on the page's clock.
 *
 * @param stamps - The batch's and the report's stamps.
 * @param clockOffsetMs - The worker's clock origin minus the page's, ms.
 * @param receivedMs - When the page received the report, ms on the page's clock.
 * @returns The hops; undefined when either is negative (the clocks disagree).
 */
export function transferTimings(
  stamps: EngineTransferStamps,
  clockOffsetMs: number,
  receivedMs: number,
): EngineTransferTimings | undefined {
  const pageToWorker = stamps.receivedMs + clockOffsetMs - stamps.postedMs;
  const workerToPage = receivedMs - (stamps.sentMs + clockOffsetMs);
  if (pageToWorker < 0 || workerToPage < 0) return undefined;
  return { pageToWorker, workerToPage };
}

import * as Y from 'yjs';

import { scanUpdate } from '../../assets/update-scan.js';
import { MAX_STAMP_CHECK_STEPS } from '../update-stamp-check.js';
import { readUpdateStamps } from '../update-stamp-reading.js';

/** Minimum elapsed milliseconds for equal-client-count batches of complete scan and replay. */
export interface ReplayTimes {
  /** Minimum of five batches, each containing ten small replays. */
  readonly small: number;
  /** Minimum of five batches, each containing one large replay. */
  readonly large: number;
}

/**
 * Measures all scanning and stamp reading, without candidate-counter instrumentation.
 * Ten small replays and one large replay process the same client count, so both timed sides
 * expose comparable linear CPU work to scheduler preemption. Five alternating measurements
 * per side and their minima reduce single-preemption noise; fresh documents avoid warmed state.
 * Update and document construction/cleanup are outside timing.
 *
 * @param small - The smaller encoded update.
 * @param large - The update with ten times as many clients.
 * @returns Minimum elapsed times for the equal-work batches.
 */
export function minimumReplayTimes(small: Uint8Array, large: Uint8Array): ReplayTimes {
  let smallMinimum = Infinity;
  let largeMinimum = Infinity;
  for (let repeat = 0; repeat < 5; repeat += 1) {
    smallMinimum = Math.min(smallMinimum, elapsedReplay(small, 10));
    largeMinimum = Math.min(largeMinimum, elapsedReplay(large, 1));
  }
  return { small: smallMinimum, large: largeMinimum };
}

/**
 * Times a batch of complete scans and reads against fresh boards.
 *
 * @param update - Encoded stacked clients, constructed before timing.
 * @param count - Number of independent replays in the timed batch.
 * @returns Elapsed milliseconds for the complete batch, excluding construction and cleanup.
 */
function elapsedReplay(update: Uint8Array, count: number): number {
  const docs = Array.from({ length: count }, () => new Y.Doc());
  try {
    const start = performance.now();
    for (const doc of docs) {
      const scan = scanUpdate(update, new Set(), { shouldKeepEveryStruct: true });
      const result = readUpdateStamps(doc, update, scan, MAX_STAMP_CHECK_STEPS);
      if (result.isExhausted || result.heldBack.size !== scan.items.size) {
        throw new Error('Scaling fixture did not finish the complete stacked replay');
      }
    }
    return performance.now() - start;
  } finally {
    for (const doc of docs) doc.destroy();
  }
}

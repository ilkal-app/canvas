import type { GpuPassTiming } from '../gpu-backend.js';

const NANOSECONDS_PER_MILLISECOND = 1_000_000;

/**
 * Turns resolved WebGPU timestamps into pass timings. Pass `n` wrote its begin time to query
 * `2n` and its end time to query `2n + 1`, in nanoseconds.
 *
 * @param labels - The timed passes' labels, in the order their queries were allocated.
 * @param timestamps - The resolved query set, two values per label.
 * @returns One timing per label; a pass whose end precedes its begin reports 0 ms.
 */
export function timingsFromTimestamps(
  labels: readonly string[],
  timestamps: BigUint64Array,
): GpuPassTiming[] {
  return labels.map((label, index) => {
    const begin = timestamps[2 * index] ?? 0n;
    const end = timestamps[2 * index + 1] ?? 0n;
    const durationNs = end > begin ? Number(end - begin) : 0;
    return { label, durationMs: durationNs / NANOSECONDS_PER_MILLISECOND };
  });
}

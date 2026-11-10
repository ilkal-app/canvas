/** The median and the 95th percentile of a sample, in the sample's unit. */
export interface PercentilePair {
  /** The median (nearest rank). */
  readonly p50: number;
  /** The 95th percentile (nearest rank). */
  readonly p95: number;
}

/**
 * Guards `fraction × count` against binary rounding pushing a whole rank up by one
 * (`0.95 × 60` is `57.00000000000001`).
 */
const RANK_EPSILON = 1e-9;

/**
 * The nearest-rank percentile of a sample: the smallest observed value with at least `fraction`
 * of the sample at or below it. Nearest rank, not interpolation, so a p95 frame time is a frame
 * that happened. Pure: sorts a copy.
 *
 * @param values - The sample, in any order; not modified.
 * @param fraction - The percentile as a fraction, in [0, 1] (0.95 for p95).
 * @returns The percentile, in the sample's unit.
 * @throws {RangeError} When the sample is empty or the fraction is outside [0, 1].
 */
export function percentile(values: ArrayLike<number>, fraction: number): number {
  if (values.length === 0) throw new RangeError('An empty sample has no percentile.');
  if (!(fraction >= 0 && fraction <= 1)) {
    throw new RangeError(`A percentile fraction is in [0, 1]; received ${String(fraction)}.`);
  }
  const sorted = Float64Array.from(values).sort();
  const rank = Math.ceil(fraction * sorted.length - RANK_EPSILON);
  return sorted[Math.max(rank, 1) - 1] ?? Number.NaN;
}

/**
 * The p50 and p95 of a sample, the pair the overlay and the benchmark export report.
 *
 * @param values - The sample, in any order; not modified.
 * @returns Its median and 95th percentile.
 * @throws {RangeError} When the sample is empty.
 */
export function percentilePair(values: ArrayLike<number>): PercentilePair {
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
}

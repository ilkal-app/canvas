// Board sizes for benchmarks, full or smoke. CI's smoke run (`BENCH_SMOKE=1 pnpm bench`) only proves each benchmark runs, on a GitHub-hosted runner
// whose heap cannot hold the budget-size boards; the root vitest.config.ts reads the variable
// and provides it as `isBenchSmoke`. The same file sits in each package with 50k-object benches,
// because a fixture cannot be imported across packages.
import { inject } from 'vitest';

declare module 'vitest' {
  interface ProvidedContext {
    /** Whether `pnpm bench` is CI's smoke run (`BENCH_SMOKE=1`); set by vitest.config.ts. */
    isBenchSmoke: boolean;
  }
}

/** A benchmark's size at full scale and in the smoke run. */
export interface BenchSizes {
  /** The size `pnpm bench` measures, e.g. the 50k objects of the performance budgets. */
  readonly full: number;
  /** The size CI's smoke run builds instead: small enough to run in well under 1 GB. */
  readonly smoke: number;
}

/**
 * The size a benchmark builds: `full` normally, `smoke` under `BENCH_SMOKE=1`.
 *
 * @param sizes - The full and smoke sizes.
 * @returns The size for this run.
 */
export function benchSize(sizes: BenchSizes): number {
  return inject('isBenchSmoke') ? sizes.smoke : sizes.full;
}

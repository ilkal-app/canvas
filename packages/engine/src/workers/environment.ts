/**
 * The parts of a global scope that decide how the worker pool runs: a browser window, a
 * worker (where the engine runs itself when OffscreenCanvas is available) or a test double.
 * Pass `globalThis`. Typed structurally so the engine core compiles without the DOM lib.
 */
export interface WorkerHost {
  /** The host's navigator, when it has one. */
  readonly navigator?: {
    /** Logical processors the browser reports; browsers may round or cap it. */
    readonly hardwareConcurrency?: number;
  };
  /** The `Worker` constructor, when the host can start workers. */
  // eslint-disable-next-line @typescript-eslint/naming-convention -- must match the global `Worker` so `globalThis` fits
  readonly Worker?: unknown;
}

/** What the host can do for the worker pool. */
export interface WorkerEnvironment {
  /** Whether the host can start Web Workers; without them jobs run on the main thread. */
  readonly hasWorkers: boolean;
  /** Logical processors available, at least 1. */
  readonly hardwareConcurrency: number;
}

/** Assumed when the host does not report its cores: low enough to be safe on phones. */
const FALLBACK_HARDWARE_CONCURRENCY = 2;

/**
 * The default cap on pool size. Each worker holds its own copy of the job code and any
 * per-worker state (the MSDF generator's WebAssembly heap, a loaded font), and past four the
 * main thread, not the workers, limits how fast results can be used.
 */
export const DEFAULT_MAX_WORKERS = 4;

/**
 * Detects whether a host can start workers and how many cores it has.
 *
 * @param host - The global scope to inspect, normally `globalThis`.
 * @returns The host's worker environment.
 */
export function detectWorkerEnvironment(host: WorkerHost): WorkerEnvironment {
  const reported = host.navigator?.hardwareConcurrency;
  const isUsable = reported !== undefined && Number.isInteger(reported) && reported >= 1;
  return {
    hasWorkers: typeof host.Worker === 'function',
    hardwareConcurrency: isUsable ? reported : FALLBACK_HARDWARE_CONCURRENCY,
  };
}

/**
 * Chooses how many job workers to start: one per core minus one for the main thread, at
 * least one and at most `maxWorkers`; zero when the host cannot start workers, which makes
 * the pool run every job on the main thread through its time-sliced queue.
 *
 * @param environment - What the host can do, from {@link detectWorkerEnvironment}.
 * @param maxWorkers - The largest pool to start, an integer of at least 1.
 * @returns The number of workers to start.
 * @throws {RangeError} When `maxWorkers` is not an integer of at least 1.
 */
export function chooseWorkerCount(
  environment: WorkerEnvironment,
  maxWorkers: number = DEFAULT_MAX_WORKERS,
): number {
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1) {
    throw new RangeError(`maxWorkers must be an integer of at least 1; got ${String(maxWorkers)}.`);
  }
  if (!environment.hasWorkers) return 0;
  return Math.min(maxWorkers, Math.max(1, environment.hardwareConcurrency - 1));
}

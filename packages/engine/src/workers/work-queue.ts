import { PriorityJobQueue, type QueuedJob } from './priority-job-queue.js';

/**
 * Runs one job synchronously on the calling thread. Whatever it does after its first `await`
 * happens outside the drain that started it, so the per-frame budget bounds only its
 * synchronous part.
 */
export type JobRunner<T> = (job: QueuedJob<T>) => void;

/** What one {@link WorkQueue.drain} did, for the stage timers. */
export interface DrainReport {
  /** Jobs started and finished in this drain. */
  readonly jobsRun: number;
  /** Time the drain took by the injected clock, in ms. */
  readonly elapsedMs: number;
  /** Jobs still pending when the drain returned. */
  readonly jobsRemaining: number;
}

/**
 * The main-thread time-slicer: a {@link PriorityJobQueue} whose jobs run synchronously, a
 * frame's budget at a time. A change that dirties 500 text boxes lays them out over several
 * frames while the old layout keeps drawing, instead of stalling one frame. DOM-free; the clock
 * is injected so tests are deterministic.
 */
export class WorkQueue<T> extends PriorityJobQueue<T> {
  private readonly runJob: JobRunner<T>;

  /**
   * Creates an empty queue.
   *
   * @param runJob - Runs one dequeued job; called only from {@link WorkQueue.drain}.
   */
  constructor(runJob: JobRunner<T>) {
    super();
    this.runJob = runJob;
  }

  /**
   * Runs pending jobs, most urgent first, until the queue is empty or `budgetMs` has passed.
   * The clock is read before each job and a job is started only while time remains, so a
   * zero budget runs nothing and a job that starts always finishes: the drain overruns its
   * budget by at most one job, which is why jobs should be small. A job is removed before it
   * runs; if it throws, the drain stops and rethrows, and the remaining jobs wait for the
   * next drain.
   *
   * @param budgetMs - The time this frame can spend, in ms; `Infinity` runs everything.
   * @param now - The clock, in ms (for example `performance.now`); frozen in tests.
   * @returns How many jobs ran, how long it took and how many remain.
   * @throws {RangeError} When `budgetMs` is negative or NaN.
   */
  drain(budgetMs: number, now: () => number): DrainReport {
    if (Number.isNaN(budgetMs) || budgetMs < 0) {
      throw new RangeError(
        `A drain budget must be a non-negative number of ms; got ${String(budgetMs)}.`,
      );
    }
    const startMs = now();
    let elapsedMs = 0;
    let jobsRun = 0;
    while (elapsedMs < budgetMs) {
      const job = this.dequeue();
      if (job === undefined) break;
      this.runJob(job);
      jobsRun += 1;
      elapsedMs = now() - startMs;
    }
    return { jobsRun, elapsedMs, jobsRemaining: this.size };
  }
}

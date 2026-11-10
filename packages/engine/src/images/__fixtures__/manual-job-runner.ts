// A decode job runner for tests: the real WorkerPool with no workers, whose queue runs only when
// a test calls `settle`, with every submission recorded. Jobs run through the real handlers, so
// fixture images really are rendered.
import { createDecodeJobHandler } from '../../workers/decode-job.js';
import { framesJob } from '../../workers/frames-job.js';
import type { JobId } from '../../workers/job-id.js';
import type { JobPriority } from '../../workers/job-priority.js';
import { WorkerPool } from '../../workers/worker-pool.js';
import type { ImageJobRunner } from '../level-loader.js';

/** One recorded submission. */
export interface RecordedJob {
  /** The job's id. */
  readonly id: JobId;
  /** The asset it decodes. */
  readonly assetId: string;
  /** The long edges it asked for. */
  readonly longEdgesPx: readonly number[];
  /** Its priority at submission. */
  readonly priority: JobPriority;
}

/**
 * Lets pending promises run: several microtask turns.
 *
 * @param turns - How many turns.
 */
export async function flushMicrotasks(turns = 20): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

/** The runner. */
export class ManualJobRunner implements ImageJobRunner {
  /** Every job submitted, in order. */
  readonly submitted: RecordedJob[] = [];
  /** Every priority change that reached a queued job, as `id:priority`. */
  readonly priorityChanges: string[] = [];
  /** Every cancelled job id. */
  readonly cancelled: JobId[] = [];
  /** The asset of every `frames` job submitted, in order. */
  readonly framesSubmitted: string[] = [];
  private readonly pool = new WorkerPool({
    workerCount: 0,
    fallbackHandlers: { decode: createDecodeJobHandler(), frames: framesJob },
  });

  /**
   * The jobs waiting to run.
   *
   * @returns The count.
   */
  get pendingCount(): number {
    return this.pool.pendingCount;
  }

  submit: ImageJobRunner['submit'] = (kind, request, options) => {
    const ticket = this.pool.submit(kind, request, options);
    if (kind === 'decode') {
      const { assetId, longEdgesPx } = request as unknown as {
        assetId: string;
        longEdgesPx: number[];
      };
      this.submitted.push({ id: ticket.id, assetId, longEdgesPx, priority: options.priority });
    }
    if (kind === 'frames') {
      this.framesSubmitted.push((request as unknown as { assetId: string }).assetId);
    }
    return ticket;
  };

  cancel: ImageJobRunner['cancel'] = (id) => {
    this.cancelled.push(id);
    return this.pool.cancel(id);
  };

  setPriority: ImageJobRunner['setPriority'] = (id, priority) => {
    const isQueued = this.pool.setPriority(id, priority);
    if (isQueued) this.priorityChanges.push(`${String(id)}:${priority}`);
    return isQueued;
  };

  /**
   * Runs every queued job and lets their results and any jobs they lead to settle.
   *
   * @param rounds - How many drain-and-flush rounds.
   */
  async settle(rounds = 10): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
      await flushMicrotasks();
      this.pool.drainMainThread(Number.POSITIVE_INFINITY, () => 0);
      await flushMicrotasks();
    }
  }
}

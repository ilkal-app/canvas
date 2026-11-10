import { JobCancelledError, JobFailedError } from './job-errors.js';
import { resourceContext, runJob, type JobHandlers } from './job-handlers.js';
import type { JobId } from './job-id.js';
import type { JobKind, JobRequest, JobResponse } from './job-kinds.js';
import type { JobPriority } from './job-priority.js';
import type { JobTicket, PendingJob, SubmitOptions, SubmittedJob } from './job-submission.js';
import type { QueuedJob } from './priority-job-queue.js';
import {
  createJobRequestMessage,
  describeFailure,
  isJobReplyMessage,
  isWorkerFaultMessage,
  type JobReplyMessage,
} from './protocol.js';
import { WorkQueue, type DrainReport } from './work-queue.js';
import type { PoolJob, RunningJob, WorkerSlot } from './worker-pool-state.js';
import type { WorkerTransport, WorkerTransportFactory } from './worker-transport.js';

/** How a {@link WorkerPool} is set up. */
export interface WorkerPoolOptions {
  /**
   * Workers to start, usually from `chooseWorkerCount`. 0 runs every job on the main thread
   * through {@link WorkerPool.drainMainThread}.
   */
  readonly workerCount: number;
  /** Starts each worker's transport; required when `workerCount` is above 0. */
  readonly createTransport?: WorkerTransportFactory;
  /**
   * Jobs one worker may hold at once, at least 1; default 2. Two hides the message round
   * trip behind the job before it; more would let low-priority jobs sit in a worker's inbox
   * while a `visible` job waits in the pool.
   */
  readonly maxInFlightPerWorker?: number;
  /**
   * The handlers the main-thread fallback runs (no workers, or all failed). Required, and never
   * defaulted: the pool imports no handler, so a bundle carries only the handlers its code
   * names (the engine hosts pass `{ mesh: meshJob }`), not every kind's.
   */
  readonly fallbackHandlers: JobHandlers;
}

const DEFAULT_MAX_IN_FLIGHT_PER_WORKER = 2;

function assertCount(name: string, value: number, minimum: number): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(
      `${name} must be an integer of at least ${String(minimum)}; got ${String(value)}.`,
    );
  }
}

/**
 * Runs layout, flatten, mesh and decode jobs off the main thread, so per-frame CPU stays
 * bounded. Pending jobs wait in a priority queue (`visible` > `near` > `prefetch`, FIFO within a
 * priority); jobs are dealt round-robin to N workers, each holding at most `maxInFlightPerWorker`,
 * and responses come back with their buffers transferred. Submissions made in the same tick are
 * ordered before any is sent, so a burst never lets a `prefetch` job jump a `visible` one.
 *
 * Without workers (`workerCount` 0, or after every worker failed) jobs run on the main thread
 * through the same queue, a frame budget at a time, when the frame loop calls
 * {@link WorkerPool.drainMainThread}. The pool is DOM-free: it talks to workers only through
 * {@link WorkerTransport}. It lives on the engine's thread, which is the main thread or the
 * engine's own worker.
 *
 * A worker that crashes, fails to load, breaks the protocol or reports a `worker-fault` (a
 * request it could not deserialise) is retired: its running jobs
 * fail with `worker-failed` (they are not retried, since a job that crashed one worker would
 * crash the next) and the other workers carry on.
 */
export class WorkerPool {
  private readonly queue: WorkQueue<PoolJob>;
  private readonly workers: WorkerSlot[] = [];
  private readonly running = new Map<JobId, RunningJob>();
  private readonly maxInFlightPerWorker: number;
  private readonly fallbackHandlers: JobHandlers;
  private nextWorkerIndex = 0;
  private isDispatchScheduled = false;
  private isTerminated = false;

  /**
   * Creates the pool and starts its workers.
   *
   * @param options - Worker count, transports, in-flight cap and fallback handlers.
   * @throws {RangeError} When `workerCount` is not a non-negative integer,
   *   `maxInFlightPerWorker` is not a positive integer, or workers are asked for without
   *   `createTransport`.
   */
  constructor(options: WorkerPoolOptions) {
    const { workerCount, createTransport } = options;
    this.maxInFlightPerWorker = options.maxInFlightPerWorker ?? DEFAULT_MAX_IN_FLIGHT_PER_WORKER;
    assertCount('workerCount', workerCount, 0);
    assertCount('maxInFlightPerWorker', this.maxInFlightPerWorker, 1);
    if (workerCount > 0 && createTransport === undefined) {
      throw new RangeError('createTransport is required to start workers.');
    }
    this.fallbackHandlers = options.fallbackHandlers;
    this.queue = new WorkQueue((job) => {
      this.runOnMainThread(job);
    });
    for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
      if (createTransport !== undefined) this.startWorker(workerIndex, createTransport);
    }
  }

  /**
   * Whether jobs go to workers; `false` when the pool runs them on the main thread.
   *
   * @returns `true` while at least one worker is alive.
   */
  get isUsingWorkers(): boolean {
    return this.workers.some((slot) => slot.isAlive);
  }

  /**
   * Jobs waiting to be dispatched.
   *
   * @returns The number of pending jobs.
   */
  get pendingCount(): number {
    return this.queue.size;
  }

  /**
   * Jobs posted to a worker (or started on the main thread) whose reply has not arrived,
   * including cancelled ones still occupying a worker's slot.
   *
   * @returns The number of running jobs.
   */
  get runningCount(): number {
    return this.running.size;
  }

  /**
   * Submits a job. It is dispatched in a microtask, after every other submission of the same
   * tick has been ordered by priority.
   *
   * @param kind - The kind of job.
   * @param request - Its request; not mutated. Buffers named in `options.transfer` move to the
   *   worker.
   * @param options - Its priority, transfer list and resources.
   * @returns The job's ticket.
   * @throws {Error} When the pool has been terminated.
   */
  submit<K extends JobKind>(kind: K, request: JobRequest<K>, options: SubmitOptions): JobTicket<K> {
    if (this.isTerminated) throw new Error('The worker pool has been terminated.');
    // Sound: `kind` and `request` are correlated by the signature; the union cannot see it.
    const job = { kind, request } as unknown as SubmittedJob;
    const transfer = options.transfer ?? [];
    const resources = options.resources ?? [];
    let id: JobId = 0;
    // The executor runs synchronously, so the job is queued (and `id` set) before returning.
    const response = new Promise<JobResponse<K>>((resolve, reject) => {
      id = this.queue.enqueue({ job, transfer, resources, resolve, reject }, options.priority);
    });
    this.scheduleDispatch();
    return { id, response };
  }

  /**
   * Cancels a job. A pending job is removed and never runs. A running job's promise rejects
   * at once; the worker still finishes it (a message cannot interrupt a handler), its reply
   * is dropped, and its slot is freed only when that reply arrives.
   *
   * @param id - The job to cancel.
   * @returns `true` when the job was pending or running, `false` when the pool no longer
   *   holds it (settled, cancelled or unknown).
   */
  cancel(id: JobId): boolean {
    const pending = this.queue.cancel(id);
    if (pending !== undefined) {
      pending.item.reject(new JobCancelledError(id));
      return true;
    }
    const running = this.running.get(id);
    if (running === undefined || running.isCancelled) return false;
    running.isCancelled = true;
    running.poolJob.reject(new JobCancelledError(id));
    return true;
  }

  /**
   * Retires the worker running a job, as if it had crashed: for a job that has gone unanswered
   * too long (a hung worker). The worker is terminated, every job it held fails with
   * `worker-failed`, and the pending jobs go to the other workers, or to the main thread when
   * none is left.
   *
   * @param id - A job the worker is running.
   * @param reason - Why, for the failures.
   * @returns `true` when a worker was retired; `false` when the job is not running in one.
   */
  retireWorkerOf(id: JobId, reason: Error): boolean {
    const workerIndex = this.running.get(id)?.workerIndex;
    if (workerIndex === undefined) return false;
    this.retireWorker(workerIndex, reason);
    return true;
  }

  /**
   * Changes a pending job's priority; running jobs are unaffected.
   *
   * @param id - The job.
   * @param priority - Its new priority.
   * @returns `true` when the job was pending.
   */
  setPriority(id: JobId, priority: JobPriority): boolean {
    return this.queue.setPriority(id, priority);
  }

  /**
   * Re-classifies every pending job, as the engine does when the viewport changes.
   *
   * @param classify - Returns each pending job's new priority from its kind, request and
   *   current priority. Must not call back into the pool.
   */
  reprioritize(classify: (job: PendingJob) => JobPriority): void {
    this.queue.reprioritize(({ id, priority, item }) => classify({ id, priority, ...item.job }));
  }

  /**
   * Runs pending jobs on the calling thread within a frame budget, when the pool has no
   * workers; otherwise does nothing (workers take the jobs). Call it once per frame from the
   * frame loop. Promises settle in a microtask after their job ran.
   *
   * @param budgetMs - The time this frame can spend, in ms.
   * @param now - The clock, in ms.
   * @returns What the drain did; all zeros while workers are in use.
   */
  drainMainThread(budgetMs: number, now: () => number): DrainReport {
    if (this.isUsingWorkers || this.isTerminated) {
      return { jobsRun: 0, elapsedMs: 0, jobsRemaining: this.queue.size };
    }
    return this.queue.drain(budgetMs, now);
  }

  /**
   * Stops every worker and rejects every pending and running job with a `JobCancelledError`.
   * The pool cannot be used afterwards.
   */
  terminate(): void {
    if (this.isTerminated) return;
    this.isTerminated = true;
    for (const slot of this.workers) {
      slot.isAlive = false;
      slot.transport.terminate();
    }
    const reason = 'the worker pool was terminated';
    for (const { id, item } of this.queue.clear()) item.reject(new JobCancelledError(id, reason));
    for (const [id, running] of this.running) {
      if (!running.isCancelled) running.poolJob.reject(new JobCancelledError(id, reason));
    }
    this.running.clear();
  }

  private startWorker(workerIndex: number, createTransport: WorkerTransportFactory): void {
    const transport = createTransport(workerIndex);
    this.workers.push({ transport, inFlightCount: 0, isAlive: true, sentResourceKeys: new Set() });
    transport.connect({
      onMessage: (data) => {
        this.handleMessage(workerIndex, data);
      },
      onFailure: (error) => {
        this.retireWorker(workerIndex, error);
      },
    });
  }

  private scheduleDispatch(): void {
    if (this.isDispatchScheduled || !this.isUsingWorkers) return;
    this.isDispatchScheduled = true;
    void Promise.resolve().then(() => {
      this.isDispatchScheduled = false;
      this.dispatch();
    });
  }

  /** Sends pending jobs, most urgent first, while some worker has a free slot. */
  private dispatch(): void {
    while (!this.isTerminated && this.queue.size > 0) {
      const workerIndex = this.nextWorkerWithCapacity();
      if (workerIndex === undefined) return;
      const job = this.queue.dequeue();
      if (job === undefined) return;
      this.send(workerIndex, job);
    }
  }

  /**
   * Finds the next live worker below its in-flight cap, round-robin from the worker after the
   * last one used.
   *
   * @returns The worker's index, or `undefined` when every worker is full or dead.
   */
  private nextWorkerWithCapacity(): number | undefined {
    const count = this.workers.length;
    for (let step = 0; step < count; step += 1) {
      const workerIndex = (this.nextWorkerIndex + step) % count;
      const slot = this.workers[workerIndex];
      if (slot?.isAlive === true && slot.inFlightCount < this.maxInFlightPerWorker) {
        this.nextWorkerIndex = (workerIndex + 1) % count;
        return workerIndex;
      }
    }
    return undefined;
  }

  private send(workerIndex: number, { id, item }: QueuedJob<PoolJob>): void {
    const slot = this.workers[workerIndex];
    if (slot === undefined) return;
    // Only the bytes this worker has not had: a font travels to each worker once. They
    // are copied, never transferred, so the caller's buffers stay usable.
    const unsent = item.resources.filter(({ key }) => !slot.sentResourceKeys.has(key));
    const message = createJobRequestMessage(id, item.job.kind, item.job.request, unsent);
    try {
      slot.transport.post(message, item.transfer);
    } catch (error) {
      // postMessage throws synchronously when the request cannot be cloned or a buffer in its
      // transfer list is already detached: the request is at fault, not the worker.
      item.reject(new JobFailedError(id, item.job.kind, describeFailure('invalid-request', error)));
      return;
    }
    for (const { key } of unsent) slot.sentResourceKeys.add(key);
    slot.inFlightCount += 1;
    this.running.set(id, { poolJob: item, workerIndex, isCancelled: false });
  }

  private handleMessage(workerIndex: number, data: unknown): void {
    if (isWorkerFaultMessage(data)) {
      this.retireWorker(workerIndex, new Error(data.failure.message));
      return;
    }
    if (!isJobReplyMessage(data)) {
      this.retireWorker(workerIndex, new TypeError('The worker sent a malformed job reply.'));
      return;
    }
    const running = this.running.get(data.id);
    if (running?.workerIndex !== workerIndex) return;
    this.running.delete(data.id);
    const slot = this.workers[workerIndex];
    if (slot !== undefined) slot.inFlightCount -= 1;
    if (!running.isCancelled) this.settle(data.id, running.poolJob, data);
    this.dispatch();
  }

  private settle(id: JobId, poolJob: PoolJob, reply: JobReplyMessage): void {
    if (reply.type === 'job-result') poolJob.resolve(reply.payload);
    else poolJob.reject(new JobFailedError(id, poolJob.job.kind, reply.failure));
  }

  private retireWorker(workerIndex: number, error: Error): void {
    const slot = this.workers[workerIndex];
    if (slot?.isAlive !== true) return;
    slot.isAlive = false;
    slot.inFlightCount = 0;
    slot.transport.terminate();
    const failure = describeFailure('worker-failed', error);
    for (const [id, running] of this.running) {
      if (running.workerIndex !== workerIndex) continue;
      this.running.delete(id);
      if (!running.isCancelled) {
        running.poolJob.reject(new JobFailedError(id, running.poolJob.job.kind, failure));
      }
    }
    // With a worker left, it takes the pending jobs; with none, drainMainThread runs them.
    this.dispatch();
  }

  private runOnMainThread({ id, item }: QueuedJob<PoolJob>): void {
    const running: RunningJob = { poolJob: item, workerIndex: undefined, isCancelled: false };
    this.running.set(id, running);
    const message = createJobRequestMessage(id, item.job.kind, item.job.request);
    const context = resourceContext(new Map(item.resources.map(({ key, bytes }) => [key, bytes])));
    void runJob(this.fallbackHandlers, message, context).then(({ message: reply }) => {
      if (this.running.get(id) !== running) return;
      this.running.delete(id);
      if (!running.isCancelled) this.settle(id, item, reply);
    });
  }
}

import type { JobId } from './job-id.js';
import { JOB_PRIORITIES, priorityRank, type JobPriority } from './job-priority.js';

/** A job waiting in a {@link PriorityJobQueue}: its id, its current priority and its data. */
export interface QueuedJob<T> {
  /** The id the queue assigned when the job was enqueued. */
  readonly id: JobId;
  /** The priority the job will run at. */
  readonly priority: JobPriority;
  /** The caller's data for the job, never copied or changed by the queue. */
  readonly item: T;
}

/**
 * Decides a pending job's new priority, typically from the viewport after the camera moved.
 * It must not touch the queue it is classifying.
 */
export type PriorityClassifier<T> = (job: QueuedJob<T>) => JobPriority;

/**
 * Stale entries tolerated before the buckets are rebuilt: compacting only once stale entries
 * outnumber live ones (and exceed this floor) keeps cancellation O(1) amortised.
 */
const COMPACTION_FLOOR = 1024;

/**
 * A priority queue of jobs: `visible` before `near` before `prefetch`,
 * FIFO within a priority, with cancellation by id and re-prioritisation when the viewport
 * changes. It is DOM-free and single-threaded; the main-thread `WorkQueue` and the
 * `WorkerPool` both order their pending jobs with it.
 *
 * Why buckets and not a heap: one FIFO array per priority makes enqueue and dequeue O(1). A
 * cancelled or re-prioritised job is left in its old bucket as a stale entry (the `live` map
 * no longer points at it) and skipped when reached; the buckets are rebuilt when stale entries
 * pile up, and after a bulk {@link PriorityJobQueue.reprioritize}.
 */
export class PriorityJobQueue<T> {
  /** The current entry of every pending job, in id order (a `Map` keeps insertion order). */
  private readonly live = new Map<JobId, QueuedJob<T>>();
  private buckets: QueuedJob<T>[][] = JOB_PRIORITIES.map(() => []);
  private heads: number[] = JOB_PRIORITIES.map(() => 0);
  private staleCount = 0;
  private nextId: JobId = 1;

  /**
   * The number of pending jobs.
   *
   * @returns How many jobs are queued and not yet dequeued or cancelled.
   */
  get size(): number {
    return this.live.size;
  }

  /**
   * Adds a job behind every pending job of the same priority.
   *
   * @param item - The job's data; the queue keeps the reference and never changes it.
   * @param priority - How urgently the job is needed.
   * @returns The new job's id.
   * @throws {RangeError} When `priority` is not a {@link JobPriority}; nothing is queued.
   */
  enqueue(item: T, priority: JobPriority): JobId {
    const bucket = this.bucketOf(priority);
    const job: QueuedJob<T> = { id: this.nextId++, priority, item };
    this.live.set(job.id, job);
    bucket.push(job);
    return job.id;
  }

  /**
   * Removes and returns the most urgent job, the oldest among equals.
   *
   * @returns The job, or `undefined` when the queue is empty.
   */
  dequeue(): QueuedJob<T> | undefined {
    const job = this.peek();
    if (job !== undefined) {
      const rank = priorityRank(job.priority);
      this.heads[rank] = (this.heads[rank] ?? 0) + 1;
      this.live.delete(job.id);
    }
    return job;
  }

  /**
   * Returns the job {@link PriorityJobQueue.dequeue} would return, without removing it.
   *
   * @returns The most urgent pending job, or `undefined` when the queue is empty.
   */
  peek(): QueuedJob<T> | undefined {
    for (let rank = 0; rank < this.buckets.length; rank += 1) {
      const bucket = this.buckets[rank] ?? [];
      let head = this.heads[rank] ?? 0;
      for (let job = bucket[head]; job !== undefined; job = bucket[head]) {
        if (this.live.get(job.id) === job) {
          this.heads[rank] = head;
          return job;
        }
        head += 1;
        this.staleCount -= 1;
      }
      this.buckets[rank] = [];
      this.heads[rank] = 0;
    }
    return undefined;
  }

  /**
   * Tells whether a job is still pending.
   *
   * @param id - The job's id.
   * @returns `true` when the job is queued, `false` once dequeued or cancelled.
   */
  has(id: JobId): boolean {
    return this.live.has(id);
  }

  /**
   * Removes a pending job so it never runs.
   *
   * @param id - The job's id.
   * @returns The removed job, or `undefined` when no job with that id is pending.
   */
  cancel(id: JobId): QueuedJob<T> | undefined {
    const job = this.live.get(id);
    if (job === undefined) return undefined;
    this.live.delete(id);
    this.markStale();
    return job;
  }

  /**
   * Moves one pending job to another priority. It keeps its place by enqueue order among the
   * jobs of its new priority.
   *
   * @param id - The job's id.
   * @param priority - The job's new priority.
   * @returns `true` when the job is pending (and now has `priority`), `false` otherwise.
   * @throws {RangeError} When `priority` is not a {@link JobPriority}; the job is unchanged.
   */
  setPriority(id: JobId, priority: JobPriority): boolean {
    this.bucketOf(priority); // Validates before any change: throws on an unknown priority.
    const job = this.live.get(id);
    if (job === undefined) return false;
    if (job.priority === priority) return true;
    const moved: QueuedJob<T> = { ...job, priority };
    this.live.set(id, moved);
    this.insertInIdOrder(moved);
    this.markStale();
    return true;
  }

  /**
   * Re-classifies every pending job at once, as the engine does when the viewport changes:
   * objects that came on screen become `visible`, those that left drop to `near` or
   * `prefetch`. FIFO order within each priority is preserved. O(n) in pending jobs.
   *
   * @param classify - Returns each pending job's new priority.
   * @throws {RangeError} When `classify` returns something that is not a {@link JobPriority};
   *   no job is changed.
   */
  reprioritize(classify: PriorityClassifier<T>): void {
    const moved: QueuedJob<T>[] = [];
    for (const job of this.live.values()) {
      const priority = classify(job);
      if (priority !== job.priority) {
        this.bucketOf(priority); // Validates before any change: throws on an unknown priority.
        moved.push({ ...job, priority });
      }
    }
    for (const job of moved) this.live.set(job.id, job);
    if (moved.length > 0) this.rebuild();
  }

  /**
   * Removes every pending job.
   *
   * @returns The jobs that were pending, in enqueue order.
   */
  clear(): QueuedJob<T>[] {
    const jobs = [...this.live.values()];
    this.live.clear();
    this.rebuild();
    return jobs;
  }

  private bucketOf(priority: JobPriority): QueuedJob<T>[] {
    const bucket = this.buckets[priorityRank(priority)];
    if (bucket === undefined) throw new RangeError(`Unknown job priority "${priority}".`);
    return bucket;
  }

  /**
   * Inserts a job into its bucket after every entry with a smaller id (binary search).
   *
   * @param job - The job to insert, already recorded in `live`.
   */
  private insertInIdOrder(job: QueuedJob<T>): void {
    const bucket = this.bucketOf(job.priority);
    let low = this.heads[priorityRank(job.priority)] ?? 0;
    let high = bucket.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((bucket[middle]?.id ?? Infinity) < job.id) low = middle + 1;
      else high = middle;
    }
    bucket.splice(low, 0, job);
  }

  private markStale(): void {
    this.staleCount += 1;
    if (this.staleCount > COMPACTION_FLOOR && this.staleCount > this.live.size) this.rebuild();
  }

  /** Refills the buckets from the live entries, which iterate in id order. */
  private rebuild(): void {
    this.buckets = JOB_PRIORITIES.map(() => []);
    this.heads = JOB_PRIORITIES.map(() => 0);
    this.staleCount = 0;
    for (const job of this.live.values()) this.bucketOf(job.priority).push(job);
  }
}

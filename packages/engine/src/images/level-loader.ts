import type { AssetId } from '@canvas/schema';

import { JobFailedError } from '../workers/job-errors.js';
import type { JobId } from '../workers/job-id.js';
import type { DecodedLevel } from '../workers/job-kinds.js';
import { priorityRank, type JobPriority } from '../workers/job-priority.js';
import type { WorkerPool } from '../workers/worker-pool.js';

import type { AssetSource } from './asset-source.js';
import { ImageLoadDeferredError } from './image-load-deferred.js';
import type { LevelSource } from './level-source.js';
import { RetrySchedule } from './retry-schedule.js';

export type {
  ClientLevelSource,
  LevelSource,
  ServerLevelSource,
  TileLevelSource,
} from './level-source.js';

/**
 * What runs the `decode` jobs: the worker pool, or anything with its scheduling surface. A pool
 * with no workers runs its jobs when its owner calls `drainMainThread`. Runtime image support
 * exposes only submit/cancel/setPriority: EngineJobs drains the shared pool after the frame.
 * Standalone renderers may expose the optional drain, which the image pass calls within a slice.
 */
export type ImageJobRunner = Pick<WorkerPool, 'submit' | 'cancel' | 'setPriority'> &
  Partial<Pick<WorkerPool, 'drainMainThread'>>;

/** Where a {@link LevelLoader} delivers what it loaded. */
export interface LevelLoaderCallbacks {
  /**
   * A level's pixels arrived.
   *
   * @param key - The key it was requested under.
   * @param level - Its pixels.
   * @param source - Where they came from.
   */
  onLoaded(key: string, level: DecodedLevel, source: LevelSource): void;
  /**
   * A failed level's wait is over (`RetrySchedule`): the owner plans again, and a level still
   * wanted is requested again. A failure itself asks for nothing, so a missing level costs no
   * request per frame.
   */
  onRetryDue(): void;
  /**
   * A `decode` job was submitted: a pool without workers runs it only when a frame drains it, so
   * the owner asks for one.
   */
  onDecodeQueued(): void;
  /**
   * A `decode` job found nothing to run it: no job worker was started, or all were retired, and
   * this thread has no `decode` handler (images are never decoded on the thread that renders).
   * The level failed like any other; the owner reports the fault.
   *
   * @param error - The pool's error.
   */
  onDecoderMissing?(error: Error): void;
}

/**
 * Whether a job failed because nothing could run it: the pool has no live worker and no
 * handler of the kind on this thread.
 *
 * @param error - What the job rejected with.
 * @returns True for a missing handler.
 */
export function isDecoderMissing(error: unknown): error is JobFailedError {
  return error instanceof JobFailedError && error.failure.code === 'no-handler';
}

/** One requested level. */
interface Load {
  readonly key: string;
  readonly source: LevelSource;
  priority: JobPriority;
  jobId: JobId | undefined;
  isCancelled: boolean;
  /** The fetch and decode it is part of, once started. */
  run: Run | undefined;
}

/** One fetch and decode: one load, or the client levels of one asset. It holds one slot. */
interface Run {
  /** The load whose source is fetched: the most urgent. */
  readonly first: Load;
  /** Its loads: those it started with, and the client levels asked for while it fetched. */
  readonly loads: Load[];
  /** Aborts the fetch once every load of the run is cancelled. */
  readonly abort: AbortController;
  /** Whether its slot was given back: at its end, or at once when it was cancelled. */
  isReleased: boolean;
}

/**
 * Fetches and decodes image levels by priority (visible before near before prefetch): at most
 * `maxInFlight` loads run at once, the most urgent first, each a fetch through the `AssetSource`
 * and then a `decode` job on the pool, so decoding never runs on the thread that renders.
 * Client-side levels of one asset that are waiting together are resized from one decode of the
 * original. A load's priority follows the viewport until its job starts; a load no longer wanted is
 * cancelled: its fetch is aborted (`AbortSignal`) and its slot goes to the next load at once, so
 * stale fetches never hold back newly visible images during a fast zoom or pan. Asking again for a
 * key still loading joins that load; asking for a client level of an asset whose original is being
 * fetched joins that fetch, even when the batch it started with was partly cancelled, so an
 * original is fetched once while any request for it waits (once its bytes are handed to the decode
 * job, a later request fetches again). The fetch is aborted only when no load of it is left; asking
 * for a level after that starts one new fetch in place of the aborted one. On the thread that
 * renders.
 */
export class LevelLoader {
  private readonly loads = new Map<string, Load>();
  /** The runs still fetching an original, by asset: where a client level asked for joins. */
  private readonly fetching = new Map<AssetId, Run>();
  /** The runs holding a slot. */
  private readonly runs = new Set<Run>();
  private running = 0;

  /**
   * Creates a loader.
   *
   * @param assets - Where encoded bytes come from.
   * @param jobs - Where `decode` jobs run.
   * @param callbacks - Where results go.
   * @param maxInFlight - Loads running at once.
   * @param retries - When a failed level may be requested again (a few times, with backoff).
   */
  constructor(
    private readonly assets: AssetSource,
    private readonly jobs: ImageJobRunner,
    private readonly callbacks: LevelLoaderCallbacks,
    private readonly maxInFlight = 6,
    private readonly retries = new RetrySchedule<string>(),
  ) {}

  /**
   * How many loads are queued or running.
   *
   * @returns The count.
   */
  get pendingCount(): number {
    return this.loads.size;
  }

  /**
   * Whether a key is queued or running.
   *
   * @param key - The key.
   * @returns True while its load is pending.
   */
  has(key: string): boolean {
    return this.loads.has(key);
  }

  /**
   * Asks for a level, or changes the priority of one already asked for. A level that failed is
   * not asked for again while it waits for its retry, nor after the retries ran out.
   *
   * @param key - Names the level to its owner.
   * @param source - Where it comes from.
   * @param priority - How urgently it is needed.
   */
  request(key: string, source: LevelSource, priority: JobPriority): void {
    const load = this.loads.get(key);
    if (load === undefined) {
      if (!this.retries.mayTry(key)) return;
      const run = source.kind === 'client' ? this.fetching.get(source.assetId) : undefined;
      const added: Load = { key, source, priority, jobId: undefined, isCancelled: false, run };
      this.loads.set(key, added);
      run?.loads.push(added);
      return;
    }
    if (load.priority === priority) return;
    load.priority = priority;
    if (load.jobId !== undefined) this.jobs.setPriority(load.jobId, priority);
  }

  /**
   * How many fetches and decodes hold a slot now.
   *
   * @returns The count, at most `maxInFlight`.
   */
  get runningCount(): number {
    return this.running;
  }

  /**
   * Drops a level no longer wanted: dequeued, and taken out of its run. A run left with no level
   * has its job cancelled and its slot given back at once, but its fetch of an original is
   * kept until the next `pump` (or `destroy`): a level of the asset asked for before then joins
   * it, as when a zoom cancels one level and requests another in the same frame.
   *
   * @param key - The key.
   */
  cancel(key: string): void {
    const load = this.loads.get(key);
    if (load === undefined) return;
    load.isCancelled = true;
    this.loads.delete(key);
    const { run } = load;
    if (run === undefined) return;
    const index = run.loads.indexOf(load);
    if (index >= 0) run.loads.splice(index, 1);
    // A client-level batch shares one fetch and job: stop them only when none of it is left.
    if (run.loads.length > 0 || this.fetching.get(run.first.source.assetId) === run) return;
    this.stop(run, load.jobId);
  }

  /**
   * The keys of every pending load.
   *
   * @returns The keys.
   */
  keys(): IterableIterator<string> {
    return this.loads.keys();
  }

  /**
   * Forgets the failures of the levels a predicate picks, so they may be requested at once:
   * their asset's description changed.
   *
   * @param predicate - Picks the keys.
   */
  forgetFailures(predicate: (key: string) => boolean): void {
    this.retries.forgetWhere(predicate);
  }

  /**
   * Cancels every load and stops every retry wait: its owner is destroyed, and nothing it
   * started may call back after (no retry asks for a frame).
   */
  destroy(): void {
    for (const key of [...this.loads.keys()]) this.cancel(key);
    this.abortEmptyRuns();
    this.retries.stopAll();
  }

  /** Starts the most urgent queued loads while fewer than `maxInFlight` run. */
  pump(): void {
    this.abortEmptyRuns();
    while (this.running < this.maxInFlight) {
      const next = this.mostUrgentQueued();
      if (next === undefined) return;
      const loads =
        next.source.kind === 'client' ? this.queuedClientLoads(next.source.assetId) : [next];
      const run: Run = { first: next, loads, abort: new AbortController(), isReleased: false };
      for (const load of loads) load.run = run;
      if (next.source.kind === 'client') this.fetching.set(next.source.assetId, run);
      this.running += 1;
      this.runs.add(run);
      void this.run(run).finally(() => {
        this.release(run, true);
      });
    }
  }

  /**
   * Gives a run's slot back, once.
   *
   * @param run - The run.
   * @param shouldPump - Whether to start the next load now (not while the owner is cancelling).
   */
  private release(run: Run, shouldPump: boolean): void {
    if (run.isReleased) return;
    run.isReleased = true;
    this.runs.delete(run);
    this.running -= 1;
    if (shouldPump) this.pump();
  }

  /**
   * Stops a run nobody waits for: aborts its fetch, cancels its job and gives its slot back.
   *
   * @param run - The run.
   * @param jobId - Its decode job, once submitted.
   */
  private stop(run: Run, jobId: JobId | undefined): void {
    run.abort.abort();
    this.stopFetching(run);
    if (jobId !== undefined) this.jobs.cancel(jobId);
    this.release(run, false);
  }

  /** Stops the runs left with no level (their slots go to the next loads at once). */
  private abortEmptyRuns(): void {
    for (const run of [...this.runs]) if (run.loads.length === 0) this.stop(run, undefined);
  }

  /**
   * Ends a run's fetch phase: a client level asked for from now on starts its own fetch.
   *
   * @param run - The run.
   */
  private stopFetching(run: Run): void {
    const { source } = run.first;
    if (this.fetching.get(source.assetId) === run) this.fetching.delete(source.assetId);
  }

  private mostUrgentQueued(): Load | undefined {
    let best: Load | undefined;
    for (const load of this.loads.values()) {
      if (load.run !== undefined) continue;
      if (best === undefined || priorityRank(load.priority) < priorityRank(best.priority)) {
        best = load;
      }
    }
    return best;
  }

  private queuedClientLoads(assetId: AssetId): Load[] {
    return [...this.loads.values()].filter(
      (load) =>
        load.run === undefined && load.source.kind === 'client' && load.source.assetId === assetId,
    );
  }

  private async fetchBytes(source: LevelSource, signal: AbortSignal): Promise<ArrayBuffer> {
    switch (source.kind) {
      case 'server':
        return this.assets.fetchLevel(source.assetId, source.longEdgePx, signal);
      case 'client':
        return this.assets.fetchOriginal(source.assetId, signal);
      case 'tile':
        return this.assets.fetchTile(source.assetId, source.tile, signal);
    }
  }

  /**
   * Runs one load, or a batch of client levels of one asset, to the end. A decode that returns
   * fewer levels than asked for fails the missing ones, so nothing stays pending for good.
   *
   * @param run - The loads; all share one fetch and one decode job.
   */
  private async run(run: Run): Promise<void> {
    const { first } = run;
    try {
      const bytes = await this.fetchBytes(first.source, run.abort.signal);
      this.stopFetching(run);
      const live = run.loads.filter((load) => !load.isCancelled);
      if (live.length === 0) return;
      const ticket = this.jobs.submit(
        'decode',
        {
          assetId: first.source.assetId,
          bytes,
          mimeType: first.source.kind === 'client' ? first.source.mimeType : '',
          longEdgesPx: live.map((load) => load.source.longEdgePx),
        },
        { priority: bestPriority(live), transfer: [bytes] },
      );
      for (const load of live) load.jobId = ticket.id;
      this.callbacks.onDecodeQueued();
      const { levels } = await ticket.response;
      live.forEach((load, index) => {
        const level = levels[index];
        if (load.isCancelled) return;
        if (level === undefined) {
          this.fail(load);
          return;
        }
        this.loads.delete(load.key);
        this.retries.succeed(load.key);
        this.callbacks.onLoaded(load.key, level, load.source);
      });
    } catch (error) {
      this.stopFetching(run);
      // A 404 (an asset not linked to the board yet), a network error or a decode failure: the
      // image keeps what it shows, and the level waits for its retry.
      if (isDecoderMissing(error)) this.callbacks.onDecoderMissing?.(error);
      for (const load of run.loads) {
        if (!load.isCancelled)
          this.fail(load, error instanceof ImageLoadDeferredError ? error.retryAfterMs : undefined);
      }
    }
  }

  /**
   * Ends a failed or capacity-deferred load and schedules another planning opportunity.
   *
   * @param load - The load.
   * @param delayMs - A capacity wait, which does not consume failure retries.
   */
  private fail(load: Load, delayMs?: number): void {
    this.loads.delete(load.key);
    const onDue = () => {
      this.callbacks.onRetryDue();
    };
    if (delayMs === undefined) this.retries.fail(load.key, onDue);
    else this.retries.defer(load.key, delayMs, onDue);
  }
}

function bestPriority(loads: readonly Load[]): JobPriority {
  return loads.reduce<JobPriority>(
    (best, load) => (priorityRank(load.priority) < priorityRank(best) ? load.priority : best),
    'prefetch',
  );
}

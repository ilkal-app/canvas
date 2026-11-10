import type { DeviceMemoryBudget } from '../memory/device-budget.js';
import { meshJob } from '../paths/mesh-job.js';
import type { ScenePassEntry } from '../scene/scene-pass.js';
import { createStandardScenePasses } from '../scene/standard-passes.js';
import { layoutJob } from '../text/layout/layout-job.js';
import type { JobHandler, JobHandlers } from '../workers/job-handlers.js';
import { WorkerPool } from '../workers/worker-pool.js';

import type { EngineJobWorkers } from './engine-job-workers.js';

/**
 * CPU a frame gives the pool's main-thread queue (a pool without workers, or whose workers all
 * failed), ms. It runs after the frame, so the jobs' results land before the next one.
 */
export const MAIN_THREAD_JOB_BUDGET_MS = 4;

/**
 * The `msdf` fallback handler, loaded on its first job: glyph generation runs on the rendering
 * thread only when no job worker is left, so its code (the raster fallback, the font parser's
 * outlines) is a chunk of its own, fetched then, rather than part of the page or the engine
 * worker. Its jobs wait for the chunk; later jobs run as soon as they are drained.
 *
 * @returns The handler.
 */
function lazyMsdfJob(): JobHandler<'msdf'> {
  let handler: Promise<JobHandler<'msdf'>> | undefined;
  return async (request, context) => {
    handler ??= import('../text/msdf/msdf-job.js').then(({ createMsdfJobHandler }) =>
      createMsdfJobHandler(),
    );
    return (await handler)(request, context);
  };
}

/**
 * The `glyphGeometry` fallback handler, loaded on its first job as the `msdf` one is:
 * the vector glyph tier's geometry is built on the rendering thread only when no job worker is
 * left, so its code is a chunk of its own.
 *
 * @returns The handler.
 */
function lazyGlyphGeometryJob(): JobHandler<'glyphGeometry'> {
  let handler: Promise<JobHandler<'glyphGeometry'>> | undefined;
  return async (request, context) => {
    handler ??= import('../text/vector/glyph-geometry-job.js').then(
      ({ createGlyphGeometryJobHandler }) => createGlyphGeometryJobHandler(),
    );
    return (await handler)(request, context);
  };
}

/**
 * The engine runtime's one job pool: the host's
 * job workers, or, without them, a queue on the rendering thread run after each frame. The
 * standard passes build path meshes on it, the text pass lays text out and generates glyphs on
 * it, and the image pass decodes images on it; only the runtime runs its queue
 * ({@link EngineJobs.runQueued}). One per runtime, outliving a lost device (it holds no GPU
 * resources); its thread only.
 */
export class EngineJobs {
  /** The pool: `mesh` and `decode` jobs go to its job workers. */
  readonly pool: WorkerPool;

  /**
   * Starts the pool.
   *
   * @param jobWorkers - The job workers to start; none runs jobs on this thread.
   * @param extraFallback - Handlers this thread runs besides `mesh` when there are no job
   *   workers (`EngineImageSupport.decodeFallback`); none by default.
   */
  constructor(jobWorkers: EngineJobWorkers | undefined, extraFallback: JobHandlers = {}) {
    // The kinds the engine submits and nothing else (no `echo`): the pool imports no handler, so
    // this bundle carries only these, the msdf and glyphGeometry ones only as chunks loaded when needed, and
    // `decode` only where the host names one (`EngineImageSupport.decodeFallback`).
    const fallbackHandlers: JobHandlers = {
      mesh: meshJob,
      layout: layoutJob,
      msdf: lazyMsdfJob(),
      glyphGeometry: lazyGlyphGeometryJob(),
      ...extraFallback,
    };
    this.pool = new WorkerPool(
      jobWorkers && jobWorkers.count > 0
        ? { workerCount: jobWorkers.count, createTransport: jobWorkers.spawn, fallbackHandlers }
        : { workerCount: 0, fallbackHandlers },
    );
  }

  /**
   * Where the scene's passes submit jobs: submitting only, since the runtime alone runs the
   * queue.
   *
   * @returns The pool's `submit`.
   */
  get submitter(): Pick<WorkerPool, 'submit'> {
    return this.pool;
  }

  /**
   * The standard scene passes over this pool.
   *
   * @param budget - The device's memory budget: path meshes are cached under its `meshes` share,
   *   as images are kept under its `textures` share and offscreen layers under its
   *   `layers` share, so none can starve another.
   * @param onFault - Receives mesh builds that failed or timed out; called after the frame that
   *   found them, so a fault never aborts a frame.
   * @returns The passes.
   */
  scenePasses(budget: DeviceMemoryBudget, onFault: (error: Error) => void): ScenePassEntry[] {
    return createStandardScenePasses({
      jobs: this.pool,
      meshByteBudget: budget.bytesByCategory.meshes,
      layerByteBudget: budget.bytesByCategory.layers,
      onFault: (error) => {
        void Promise.resolve().then(() => {
          onFault(error);
        });
      },
    });
  }

  /**
   * Runs queued main-thread jobs for up to {@link MAIN_THREAD_JOB_BUDGET_MS}: the pool's one
   * drain site. Nothing while workers take the jobs.
   *
   * @param now - The thread's clock, ms.
   * @returns How many jobs still wait in the queue.
   */
  runQueued(now: () => number): number {
    if (this.pool.pendingCount === 0) return 0;
    return this.pool.drainMainThread(MAIN_THREAD_JOB_BUDGET_MS, now).jobsRemaining;
  }

  /**
   * Whether the pool has live job workers.
   *
   * @returns False without workers, or once all have failed.
   */
  get isUsingWorkers(): boolean {
    return this.pool.isUsingWorkers;
  }

  /** Stops the workers; jobs in flight are dropped. */
  terminate(): void {
    this.pool.terminate();
  }
}

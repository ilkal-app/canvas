import type { JobId } from '../workers/job-id.js';
import type { JobTicket, SubmitOptions } from '../workers/job-submission.js';

import type { MeshJobRequest, MeshJobResponse } from './mesh-job-payload.js';
import { runMeshJob } from './mesh-job.js';

/**
 * Builds path meshes for the path pass: at once (the mesh is returned) or later (a promise),
 * so the same pass runs with meshing on the rendering thread or in a worker pool.
 */
export interface PathMeshBuilder {
  /**
   * Builds one mesh.
   *
   * @param request - The `mesh` job's request.
   * @returns The mesh now, or a promise of it.
   */
  build(request: MeshJobRequest): MeshJobResponse | Promise<MeshJobResponse>;
  /**
   * Gives up on a build that has gone unanswered too long: a pool retires the worker running
   * it (it is hung), failing that worker's other builds too. Optional; an inline builder never
   * leaves a build unanswered.
   *
   * @param request - The request passed to `build`.
   * @param reason - Why, for the failures.
   */
  abandon?(request: MeshJobRequest, reason: Error): void;
}

/** What {@link createPooledMeshBuilder} needs of a pool: `WorkerPool.submit`. */
export interface MeshJobSubmitter {
  /**
   * Submits a `mesh` job.
   *
   * @param kind - Always `mesh`.
   * @param request - The request.
   * @param options - Its priority.
   * @returns The job's ticket.
   */
  submit(kind: 'mesh', request: MeshJobRequest, options: SubmitOptions): JobTicket<'mesh'>;
  /**
   * Retires the worker running a job (`WorkerPool.retireWorkerOf`).
   *
   * @param id - The job.
   * @param reason - Why.
   * @returns Whether a worker was retired.
   */
  retireWorkerOf(id: JobId, reason: Error): boolean;
}

const PREVIEW_BUILDERS = new WeakSet<PathMeshBuilder>();

/**
 * Builds meshes on the calling thread, synchronously: the path pass's default. In the engine
 * host the rendering thread is the engine worker, so this is off the page's main thread; the
 * pass bounds how much it builds per frame and draws the previous bucket's mesh meanwhile.
 */
export const INLINE_MESH_BUILDER: PathMeshBuilder = { build: runMeshJob };
PREVIEW_BUILDERS.add(INLINE_MESH_BUILDER);

/**
 * Builds meshes through a worker pool's `mesh` jobs at `visible` priority, so per-frame
 * CPU stays bounded; the pass draws the previous bucket's mesh until each lands.
 * Abandoning a build retires the worker running it.
 *
 * @param pool - The pool (a `WorkerPool`).
 * @returns The builder.
 */
export function createPooledMeshBuilder(pool: MeshJobSubmitter): PathMeshBuilder {
  // Each request's job, for `abandon`; weak, so a settled request's entry goes with it.
  const jobs = new WeakMap<MeshJobRequest, JobId>();
  const builder: PathMeshBuilder = {
    build: (request) => {
      const ticket = pool.submit('mesh', request, { priority: 'visible' });
      jobs.set(request, ticket.id);
      return ticket.response;
    },
    abandon: (request, reason) => {
      const id = jobs.get(request);
      if (id !== undefined) pool.retireWorkerOf(id, reason);
    },
  };
  PREVIEW_BUILDERS.add(builder);
  return builder;
}

/**
 * Recognizes only the built-in inline and pooled mesh implementations.
 *
 * @param builder - A path pass's builder.
 * @returns False for custom builders without a preview reconstruction contract.
 */
export function isPreviewMeshBuilder(builder: PathMeshBuilder): boolean {
  return PREVIEW_BUILDERS.has(builder);
}

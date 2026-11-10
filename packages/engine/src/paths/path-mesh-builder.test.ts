import { describe, expect, it } from 'vitest';

import { pathObject } from '../spatial/__fixtures__/spatial-objects.js';
import { WorkerPool } from '../workers/worker-pool.js';

import { meshJob, meshJobRequestOf, runMeshJob } from './mesh-job.js';
import { createPooledMeshBuilder, INLINE_MESH_BUILDER } from './path-mesh-builder.js';

const REQUEST_OBJECT = pathObject('p', [
  { x: 0, y: 0 },
  { x: 10, y: 10 },
]);
const REQUEST = meshJobRequestOf(REQUEST_OBJECT, 1, 0);

describe('mesh builders', () => {
  it('builds inline at once', () => {
    expect(INLINE_MESH_BUILDER.build(REQUEST)).toEqual(runMeshJob(REQUEST));
  });

  it('submits a visible-priority mesh job to a pool', async () => {
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { mesh: meshJob } });
    const submitted: string[] = [];
    const builder = createPooledMeshBuilder({
      submit: (kind, request, options) => {
        submitted.push(`${kind}:${options.priority}`);
        return pool.submit(kind, request, options);
      },
      retireWorkerOf: (id, reason) => pool.retireWorkerOf(id, reason),
    });
    const response = builder.build(REQUEST);
    pool.drainMainThread(100, () => 0);
    expect(await response).toEqual(runMeshJob(REQUEST));
    expect(submitted).toEqual(['mesh:visible']);
  });

  it('abandoning a pooled build retires the worker running its job', () => {
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { mesh: meshJob } });
    const retired: string[] = [];
    let jobId = -1;
    const builder = createPooledMeshBuilder({
      submit: (kind, request, options) => {
        const ticket = pool.submit(kind, request, options);
        jobId = ticket.id;
        return ticket;
      },
      retireWorkerOf: (id, reason) => {
        retired.push(`${String(id)}:${reason.message}`);
        return true;
      },
    });
    const other = meshJobRequestOf(REQUEST_OBJECT, 1, 0);
    builder.abandon?.(other, new Error('never built'));
    void builder.build(REQUEST);
    builder.abandon?.(REQUEST, new Error('hung'));
    pool.drainMainThread(100, () => 0);
    expect(retired).toEqual([`${String(jobId)}:hung`]);
  });
});

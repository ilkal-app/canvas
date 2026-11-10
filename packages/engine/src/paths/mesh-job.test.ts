import { describe, expect, it } from 'vitest';

import { lineObject, pathObject } from '../spatial/__fixtures__/spatial-objects.js';
import { createDefaultJobHandlers } from '../workers/default-job-handlers.js';
import { WorkerPool } from '../workers/worker-pool.js';

import { elbowRoute } from './elbow-route.js';
import { flattenToleranceOf } from './flatten-bucket.js';
import { buildLineMesh } from './line-mesh.js';
import { meshJob, meshJobRequestOf, runMeshJob } from './mesh-job.js';
import { buildPathMesh } from './path-mesh.js';

const SQUARE = pathObject(
  'square',
  [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ],
  { isClosed: true, isFilled: true, strokeWidth: 4 },
);

describe('meshJobRequestOf', () => {
  it('carries the network, stroke width and fill flag with the version and bucket', () => {
    expect(meshJobRequestOf(SQUARE, 3, -2)).toEqual({
      objectId: 'square',
      version: 3,
      bucket: -2,
      network: { vertices: SQUARE.vertices, segments: SQUARE.segments },
      strokeWidth: 4,
      isFilled: true,
    });
    const bare = { ...SQUARE, stroke: null, fill: null };
    expect(meshJobRequestOf(bare, 1, 0)).toMatchObject({ strokeWidth: 0, isFilled: false });
  });
});

describe('a line’s mesh job', () => {
  const line = lineObject('arrow', {
    route: 'elbow',
    points: [
      { x: 0, y: 0 },
      { x: 80, y: 30 },
    ],
    stroke: { color: [0, 0, 0, 1], width: 3 },
    endCap: 'arrow',
  });

  it('carries the elbow route and caps, no network and no fill', () => {
    expect(meshJobRequestOf(line, 2, 1)).toEqual({
      objectId: 'arrow',
      version: 2,
      bucket: 1,
      network: { vertices: [], segments: [] },
      strokeWidth: 3,
      isFilled: false,
      line: {
        route: elbowRoute({ x: 0, y: 0 }, { x: 80, y: 30 }),
        startCap: 'none',
        endCap: 'arrow',
      },
    });
  });

  it('builds the line’s mesh at the tolerance of the bucket', () => {
    const response = runMeshJob(meshJobRequestOf(line, 2, 1));
    const expected = buildLineMesh({
      route: elbowRoute({ x: 0, y: 0 }, { x: 80, y: 30 }),
      startCap: 'none',
      endCap: 'arrow',
      strokeWidth: 3,
      tolerance: flattenToleranceOf(1),
    });
    expect(response.vertices).toEqual(expected.vertices);
    expect(response.fillVertexCount).toBe(0);
    expect(response.strokeVertexCount).toBe(expected.strokeVertexCount);
  });
});

describe('runMeshJob', () => {
  it('builds the mesh at the tolerance of the bucket', () => {
    const response = runMeshJob(meshJobRequestOf(SQUARE, 3, 4));
    const expected = buildPathMesh({
      network: SQUARE,
      strokeWidth: 4,
      isFilled: true,
      tolerance: flattenToleranceOf(4),
    });
    expect(response).toEqual({
      objectId: 'square',
      version: 3,
      bucket: 4,
      vertices: expected.vertices,
      fillVertexCount: expected.fillVertexCount,
      strokeVertexCount: expected.strokeVertexCount,
      bounds: expected.bounds,
    });
  });

  it('reports no bounds for a path that draws nothing', () => {
    const empty = { ...SQUARE, vertices: [], segments: [] };
    expect(runMeshJob(meshJobRequestOf(empty, 1, 0)).bounds).toBeNull();
  });
});

describe('meshJob', () => {
  it('transfers the vertex buffer back', async () => {
    const outcome = await meshJob(meshJobRequestOf(SQUARE, 1, 0));
    expect(outcome.transfer).toEqual([outcome.response.vertices.buffer]);
  });

  it('is registered with the default handlers, so the pool runs it', async () => {
    expect(createDefaultJobHandlers().mesh).toBe(meshJob);
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: createDefaultJobHandlers() });
    const ticket = pool.submit('mesh', meshJobRequestOf(SQUARE, 2, 0), { priority: 'visible' });
    pool.drainMainThread(100, () => 0);
    const response = await ticket.response;
    expect(response).toMatchObject({ objectId: 'square', version: 2, bucket: 0 });
    expect(response.vertices.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';

import { squarePath } from './__fixtures__/path-scene.js';
import { MeshBuilds } from './mesh-builds.js';
import type { MeshJobRequest, MeshJobResponse } from './mesh-job-payload.js';
import { meshJobRequestOf, runMeshJob } from './mesh-job.js';

const REQUEST = meshJobRequestOf(squarePath('p', 0), 1, 0);

// A builder whose promises settle when a test says so.
function deferredBuilder(): {
  build: (request: MeshJobRequest) => Promise<MeshJobResponse>;
  abandon: (request: MeshJobRequest, reason: Error) => void;
  settle: (outcome: 'resolve' | 'reject') => Promise<void>;
  count: () => number;
  abandoned: string[];
} {
  const settles: { resolve: () => void; reject: () => void }[] = [];
  const abandoned: string[] = [];
  let count = 0;
  return {
    abandoned,
    abandon: (request, reason) => {
      abandoned.push(`${request.objectId}: ${reason.message}`);
    },
    build: (request) => {
      count += 1;
      return new Promise((resolve, reject) => {
        settles.push({
          resolve: () => {
            resolve(runMeshJob(request));
          },
          reject: () => {
            reject(new Error('worker crashed'));
          },
        });
      });
    },
    settle: async (outcome) => {
      for (const settle of settles.splice(0)) settle[outcome]();
      await Promise.resolve();
      await Promise.resolve();
    },
    count: () => count,
  };
}

function setUp(timeoutFrames = 3) {
  const builder = deferredBuilder();
  const landed: MeshJobResponse[] = [];
  const faults: string[] = [];
  const builds = new MeshBuilds({
    builder,
    onLanded: (response) => landed.push(response),
    onFault: (error) => faults.push(error.message),
    timeoutFrames,
  });
  return { builder, builds, landed, faults };
}

describe('MeshBuilds', () => {
  it('sends a build once and delivers it when it lands', async () => {
    const { builder, builds, landed } = setUp();
    builds.beginFrame();
    expect(builds.request(REQUEST)).toBeUndefined();
    expect(builds.canRequest(REQUEST)).toBe(false);
    expect(builds.size).toBe(1);
    await builder.settle('resolve');
    expect(landed).toHaveLength(1);
    expect(builds.size).toBe(0);
    expect(builds.canRequest(REQUEST)).toBe(true);
  });

  it('returns an inline build at once', () => {
    const builds = new MeshBuilds({
      builder: { build: runMeshJob },
      onLanded: () => undefined,
      onFault: () => undefined,
    });
    expect(builds.request(REQUEST)).toEqual(runMeshJob(REQUEST));
    expect(builds.size).toBe(0);
  });

  it('times an unanswered build out, retires its worker and meshes the path inline once', async () => {
    const { builder, builds, landed, faults } = setUp(3);
    builds.beginFrame();
    builds.request(REQUEST);
    builds.beginFrame();
    builds.beginFrame();
    expect(builds.size).toBe(1);
    builds.beginFrame();
    expect(builds.size).toBe(0);
    expect(builder.abandoned).toEqual(['p: A mesh job went unanswered for 3 frames.']);
    expect(faults).toEqual([
      'Path mesh jobs: 1 timed out (their workers were retired); meshed inline instead.',
    ]);
    expect(landed).toEqual([runMeshJob(REQUEST)]);
    // The pool's late answer is ignored.
    await builder.settle('resolve');
    expect(landed).toHaveLength(1);
  });

  it('reports a frame of timed-out builds as one fault', () => {
    const { builder, builds, landed, faults } = setUp(2);
    builds.beginFrame();
    const ids = Array.from({ length: 50 }, (unused, index) => `p${String(index)}`);
    for (const [index, id] of ids.entries()) {
      builds.request(meshJobRequestOf(squarePath(id, index), 1, 0));
    }
    builds.beginFrame();
    builds.beginFrame();
    expect(faults).toEqual([
      'Path mesh jobs: 50 timed out (their workers were retired); meshed inline instead.',
    ]);
    expect(builder.abandoned).toHaveLength(50);
    expect(landed).toHaveLength(50);
    builds.beginFrame();
    expect(faults).toHaveLength(1);
  });

  it('meshes a failed build inline at the next frame, with one fault for the frame', async () => {
    const { builder, builds, landed, faults } = setUp();
    builds.beginFrame();
    builds.request(REQUEST);
    builds.request(meshJobRequestOf(squarePath('q', 1), 1, 0));
    await builder.settle('reject');
    expect(landed).toEqual([]);
    expect(builds.size).toBe(2);
    expect(builds.canRequest(REQUEST)).toBe(false);
    builds.beginFrame();
    expect(faults).toEqual(['Path mesh jobs: 2 failed; meshed inline instead.']);
    expect(landed).toHaveLength(2);
    expect(builds.size).toBe(0);
    expect(builder.abandoned).toEqual([]);
  });

  it('does not try again a network whose inline build throws, until it changes', () => {
    const faults: string[] = [];
    const builds = new MeshBuilds({
      builder: {
        build: () => {
          throw new RangeError('bad network');
        },
      },
      onLanded: () => undefined,
      onFault: (error) => faults.push(error.message),
    });
    expect(builds.request(REQUEST)).toBeUndefined();
    expect(faults).toEqual(['The mesh of path "p" cannot be built (bad network).']);
    expect(builds.canRequest(REQUEST)).toBe(false);
    expect(builds.canRequest({ ...REQUEST, version: 2 })).toBe(true);
    builds.forget('p');
    expect(builds.canRequest(REQUEST)).toBe(true);
  });

  it('marks a path unbuildable when its inline fallback throws too', async () => {
    const { builder, builds, faults } = setUp();
    const broken = {
      ...REQUEST,
      network: { vertices: [], segments: [null] },
    } as unknown as MeshJobRequest;
    builds.beginFrame();
    builds.request(broken);
    await builder.settle('reject');
    builds.beginFrame();
    expect(faults).toEqual([
      'Path mesh jobs: 1 failed; meshed inline instead; 1 cannot be built: "p".',
    ]);
    expect(builds.canRequest(broken)).toBe(false);
  });

  it('sums up a frame of timed-out and failed builds in one fault', async () => {
    const faults: string[] = [];
    const landed: MeshJobResponse[] = [];
    const builds = new MeshBuilds({
      builder: {
        // `p` hangs; every other build fails at once.
        build: (request) =>
          request.objectId === 'p'
            ? new Promise<MeshJobResponse>(() => undefined)
            : Promise.reject(new Error('worker crashed')),
      },
      onLanded: (response) => landed.push(response),
      onFault: (error) => faults.push(error.message),
      timeoutFrames: 1,
    });
    builds.beginFrame();
    builds.request(REQUEST);
    builds.request(meshJobRequestOf(squarePath('q', 1), 1, 0));
    await Promise.resolve();
    builds.beginFrame();
    expect(faults).toEqual([
      'Path mesh jobs: 1 timed out (their workers were retired), 1 failed; meshed inline instead.',
    ]);
    expect(landed.map(({ objectId }) => objectId).sort()).toEqual(['p', 'q']);
  });

  it('forgets a failed build waiting to be meshed inline, and a failure after stopping', async () => {
    const { builder, builds, landed, faults } = setUp();
    builds.beginFrame();
    builds.request(REQUEST);
    builds.request(meshJobRequestOf(squarePath('q', 1), 1, 0));
    await builder.settle('reject');
    builds.forget('p');
    expect(builds.size).toBe(1);
    builds.beginFrame();
    expect(landed.map(({ objectId }) => objectId)).toEqual(['q']);
    expect(faults).toEqual(['Path mesh jobs: 1 failed; meshed inline instead.']);
    builds.request(REQUEST);
    builds.stop();
    await builder.settle('reject');
    builds.beginFrame();
    expect(builds.size).toBe(0);
    expect(faults).toHaveLength(1);
  });

  it('forgets the builds of a path, and ignores everything once stopped', async () => {
    const { builder, builds, landed } = setUp();
    builds.beginFrame();
    builds.request(REQUEST);
    builds.request(meshJobRequestOf(squarePath('q', 1), 1, 0));
    builds.forget('p');
    expect(builds.size).toBe(1);
    builds.stop();
    expect(builds.size).toBe(0);
    await builder.settle('resolve');
    expect(landed).toEqual([]);
    expect(builder.count()).toBe(2);
  });
});

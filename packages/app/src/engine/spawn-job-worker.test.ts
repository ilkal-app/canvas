import { afterEach, describe, expect, it, vi } from 'vitest';

import { engineJobWorkers } from './spawn-job-worker.js';

const transport = vi.hoisted(() => ({ wrapped: [] as unknown[] }));

// Only the sizing and the wrapping are checked here; the pool itself is the engine's.
vi.mock('@canvas/engine', () => ({
  createWebWorkerTransport: (worker: unknown) => {
    transport.wrapped.push(worker);
    return { worker };
  },
  detectWorkerEnvironment: (scope: { cores: number }) => ({
    hasWorkers: true,
    hardwareConcurrency: scope.cores,
  }),
  chooseWorkerCount: (environment: { hardwareConcurrency: number }) =>
    environment.hardwareConcurrency - 1,
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('engineJobWorkers', () => {
  it('sizes the pool for the scope and starts job-worker.ts as a module worker', () => {
    const started: { url: string; options: unknown }[] = [];
    // A Worker stand-in that records how it was started.
    const workerStandIn = vi.fn(function (this: unknown, url: URL, options: unknown) {
      started.push({ url: url.href, options });
    });
    vi.stubGlobal('Worker', workerStandIn);
    const workers = engineJobWorkers({ cores: 4 } as never);
    expect(workers.count).toBe(3);
    const result = workers.spawn(0);
    expect(started).toEqual([
      { url: expect.stringMatching(/\/job-worker\.ts$/) as unknown, options: { type: 'module' } },
    ]);
    expect(result).toEqual({ worker: transport.wrapped[0] });
  });
});

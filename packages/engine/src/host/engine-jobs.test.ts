import { describe, expect, it } from 'vitest';

import { createFakeTransports } from '../workers/__fixtures__/fake-worker-transport.js';

import { EngineJobs } from './engine-jobs.js';

describe('EngineJobs', () => {
  it('reports job workers in use while one is alive, and not once they have all failed', () => {
    const { transports, createTransport } = createFakeTransports(2);
    const jobs = new EngineJobs({ count: 2, spawn: createTransport });
    expect(jobs.isUsingWorkers).toBe(true);
    transports[0]?.crash(new Error('The script did not load.'));
    expect(jobs.isUsingWorkers).toBe(true);
    transports[1]?.crash(new Error('The script did not load.'));
    expect(jobs.isUsingWorkers).toBe(false);
    jobs.terminate();
  });

  it('reports no job workers without any', () => {
    expect(new EngineJobs(undefined).isUsingWorkers).toBe(false);
    const { createTransport } = createFakeTransports(0);
    expect(new EngineJobs({ count: 0, spawn: createTransport }).isUsingWorkers).toBe(false);
  });
});

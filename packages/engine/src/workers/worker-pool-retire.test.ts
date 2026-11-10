import { describe, expect, it } from 'vitest';

import { createFakeTransports, flushMicrotasks } from './__fixtures__/fake-worker-transport.js';
import { createDefaultJobHandlers } from './default-job-handlers.js';
import { WorkerPool } from './worker-pool.js';

const echo = (message: string) => ({ message, bytes: new ArrayBuffer(4) });

describe('WorkerPool.retireWorkerOf', () => {
  it('retires a hung job’s worker, failing its jobs and moving the queue to the others', async () => {
    const { transports, createTransport } = createFakeTransports(2);
    const pool = new WorkerPool({
      workerCount: 2,
      maxInFlightPerWorker: 1,
      createTransport,
      fallbackHandlers: createDefaultJobHandlers(),
    });
    const hung = pool.submit('echo', echo('hung'), { priority: 'visible' });
    const other = pool.submit('echo', echo('other'), { priority: 'visible' });
    const waiting = pool.submit('echo', echo('waiting'), { priority: 'visible' });
    await flushMicrotasks();

    expect(pool.retireWorkerOf(hung.id, new Error('no answer'))).toBe(true);
    await expect(hung.response).rejects.toMatchObject({
      failure: { code: 'worker-failed', message: 'no answer' },
    });
    expect(transports[0]?.isTerminated).toBe(true);
    await transports[1]?.answer();
    await flushMicrotasks();
    await transports[1]?.answer();
    await expect(other.response).resolves.toMatchObject({ message: 'other' });
    await expect(waiting.response).resolves.toMatchObject({ message: 'waiting' });
    // A job no worker is running retires nothing.
    expect(pool.retireWorkerOf(hung.id, new Error('again'))).toBe(false);
    expect(pool.isUsingWorkers).toBe(true);
  });
});

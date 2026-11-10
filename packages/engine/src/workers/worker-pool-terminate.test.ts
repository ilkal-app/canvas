import { describe, expect, it } from 'vitest';

import { flushMicrotasks } from './__fixtures__/fake-worker-transport.js';
import { echoJob } from './echo-job.js';
import { WorkerPool } from './worker-pool.js';

describe('WorkerPool.terminate', () => {
  it('drops the answer of a main-thread job it was running, and ignores a second call', async () => {
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: { echo: echoJob } });
    const ticket = pool.submit(
      'echo',
      { message: 'late', bytes: new ArrayBuffer(4) },
      { priority: 'visible' },
    );
    const outcome = ticket.response.then(
      () => 'answered',
      (error: unknown) => (error instanceof Error ? error.name : 'unknown'),
    );
    // The handler has started; its answer settles on a later microtask.
    pool.drainMainThread(100, () => 0);
    pool.terminate();
    pool.terminate();
    await flushMicrotasks();
    expect(await outcome).toBe('JobCancelledError');
  });
});

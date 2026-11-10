import { describe, expect, it } from 'vitest';

import {
  createFakeTransports,
  flushMicrotasks,
  type FakeWorkerTransport,
} from './__fixtures__/fake-worker-transport.js';
import { createDefaultJobHandlers } from './default-job-handlers.js';
import { chooseWorkerCount, detectWorkerEnvironment } from './environment.js';
import { JobCancelledError, JobFailedError } from './job-errors.js';
import type { JobHandlers } from './job-handlers.js';
import type { JobRequest } from './job-kinds.js';
import { WorkerPool, type WorkerPoolOptions } from './worker-pool.js';

const HANDLERS = createDefaultJobHandlers();

function echo(message: string): JobRequest<'echo'> {
  return { message, bytes: new ArrayBuffer(4) };
}

function postedMessages(transport: FakeWorkerTransport | undefined): string[] {
  return (transport?.posted ?? []).map(({ message }) =>
    message.kind === 'echo' ? message.payload.message : message.kind,
  );
}

function createPool(
  workerCount: number,
  maxInFlightPerWorker = 1,
): { pool: WorkerPool; transports: FakeWorkerTransport[] } {
  const { transports, createTransport } = createFakeTransports(workerCount);
  const options = { maxInFlightPerWorker, createTransport, fallbackHandlers: HANDLERS };
  return { pool: new WorkerPool({ workerCount, ...options }), transports };
}

describe('WorkerPool scheduling', () => {
  it('orders a burst of submissions by priority before dispatching any', async () => {
    const { pool, transports } = createPool(1);
    pool.submit('echo', echo('prefetch'), { priority: 'prefetch' });
    pool.submit('echo', echo('near'), { priority: 'near' });
    pool.submit('echo', echo('visible'), { priority: 'visible' });

    await flushMicrotasks();
    expect(postedMessages(transports[0])).toEqual(['visible']);

    await transports[0]?.answer();
    await flushMicrotasks();
    await transports[0]?.answer();
    await flushMicrotasks();
    expect(postedMessages(transports[0])).toEqual(['visible', 'near', 'prefetch']);
  });

  it('deals jobs round-robin across workers', async () => {
    const { pool, transports } = createPool(3);
    for (const name of ['a', 'b', 'c']) pool.submit('echo', echo(name), { priority: 'visible' });

    await flushMicrotasks();

    expect(transports.map(postedMessages)).toEqual([['a'], ['b'], ['c']]);
  });

  it('holds jobs back once every worker has its in-flight cap', async () => {
    const { pool, transports } = createPool(2, 2);
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) {
      pool.submit('echo', echo(name), { priority: 'visible' });
    }

    await flushMicrotasks();

    expect(transports.map(postedMessages)).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
    expect(pool.pendingCount).toBe(2);
    expect(pool.runningCount).toBe(4);
  });

  it('sends the next job to a worker as soon as it replies', async () => {
    const { pool, transports } = createPool(2, 1);
    for (const name of ['a', 'b', 'c']) pool.submit('echo', echo(name), { priority: 'visible' });
    await flushMicrotasks();

    await transports[1]?.answer();
    await flushMicrotasks();

    expect(transports.map(postedMessages)).toEqual([['a'], ['b', 'c']]);
  });

  it('resolves a job with its response and posts the request with its transfer list', async () => {
    const { pool, transports } = createPool(1);
    const request = echo('ping');

    const ticket = pool.submit('echo', request, {
      priority: 'visible',
      transfer: [request.bytes],
    });
    await flushMicrotasks();
    await transports[0]?.answer();

    await expect(ticket.response).resolves.toEqual({ message: 'ping', bytes: request.bytes });
    expect(transports[0]?.posted[0]).toEqual({
      message: { type: 'job-request', id: ticket.id, kind: 'echo', payload: request },
      transfer: [request.bytes],
    });
    expect(pool.runningCount).toBe(0);
  });

  it('rejects with a JobFailedError carrying the structured failure from the worker', async () => {
    const { pool, transports } = createPool(1);
    // The default `decode` handler has no bitmap factory, so it fails on an encoded file.
    const ticket = pool.submit(
      'decode',
      { assetId: 'image-1', bytes: new ArrayBuffer(4), mimeType: 'image/avif', longEdgesPx: [128] },
      { priority: 'visible' },
    );
    await flushMicrotasks();
    await transports[0]?.answer();

    const error: unknown = await ticket.response.catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(JobFailedError);
    expect(error).toMatchObject({
      jobId: ticket.id,
      kind: 'decode',
      failure: { code: 'handler-failed', name: 'Error' },
    });
  });

  it('dispatches by a priority changed after submission', async () => {
    const { pool, transports } = createPool(1);
    pool.submit('echo', echo('near'), { priority: 'near' });
    const late = pool.submit('echo', echo('prefetch'), { priority: 'prefetch' });

    expect(pool.setPriority(late.id, 'visible')).toBe(true);
    await flushMicrotasks();

    expect(postedMessages(transports[0])).toEqual(['prefetch']);
  });

  it('re-prioritises pending jobs from their kind and request when the viewport changes', async () => {
    const { pool, transports } = createPool(1);
    for (const name of ['left', 'centre', 'right']) {
      pool.submit('echo', echo(name), { priority: 'prefetch' });
    }

    pool.reprioritize((job) =>
      job.kind === 'echo' && job.request.message === 'right' ? 'visible' : job.priority,
    );
    await flushMicrotasks();

    expect(postedMessages(transports[0])).toEqual(['right']);
  });
});

describe('WorkerPool cancellation', () => {
  it('cancels a pending job: it is never posted and its promise rejects', async () => {
    const { pool, transports } = createPool(1);
    const ticket = pool.submit('echo', echo('stale'), { priority: 'visible' });

    expect(pool.cancel(ticket.id)).toBe(true);
    await flushMicrotasks();

    await expect(ticket.response).rejects.toBeInstanceOf(JobCancelledError);
    expect(transports[0]?.posted).toEqual([]);
  });

  it('cancels a running job at once and drops its late reply, freeing the slot then', async () => {
    const { pool, transports } = createPool(1);
    const running = pool.submit('echo', echo('running'), { priority: 'visible' });
    pool.submit('echo', echo('next'), { priority: 'visible' });
    await flushMicrotasks();

    expect(pool.cancel(running.id)).toBe(true);
    await expect(running.response).rejects.toMatchObject({ jobId: running.id });
    await flushMicrotasks();
    expect(postedMessages(transports[0])).toEqual(['running']);

    await transports[0]?.answer();
    await flushMicrotasks();
    expect(postedMessages(transports[0])).toEqual(['running', 'next']);
  });

  it('reports false when cancelling or re-prioritising a job it does not hold', async () => {
    const { pool, transports } = createPool(1);
    const ticket = pool.submit('echo', echo('done'), { priority: 'visible' });
    await flushMicrotasks();
    await transports[0]?.answer();
    await ticket.response;

    expect(pool.cancel(ticket.id)).toBe(false);
    expect(pool.setPriority(ticket.id, 'near')).toBe(false);
    expect(pool.cancel(12345)).toBe(false);
  });
});

describe('the fake worker transport', () => {
  it('leaves unanswered requests alone when asked to answer an unknown id', async () => {
    const { pool, transports } = createPool(1);
    pool.submit('echo', echo('a'), { priority: 'visible' });
    await flushMicrotasks();

    await expect(transports[0]?.answer(999)).rejects.toThrow('No such unanswered request.');
    expect(transports[0]?.unansweredIds).toHaveLength(1);
  });
});

describe('WorkerPool failures', () => {
  it('fails a crashed worker’s jobs and keeps serving the rest on the other workers', async () => {
    const { pool, transports } = createPool(2);
    const onCrashed = pool.submit('echo', echo('a'), { priority: 'visible' });
    const onHealthy = pool.submit('echo', echo('b'), { priority: 'visible' });
    const waiting = pool.submit('echo', echo('c'), { priority: 'visible' });
    await flushMicrotasks();

    transports[0]?.crash(new Error('out of memory'));

    await expect(onCrashed.response).rejects.toMatchObject({
      failure: { code: 'worker-failed', message: 'out of memory' },
    });
    expect(transports[0]?.isTerminated).toBe(true);
    await transports[1]?.answer();
    await flushMicrotasks();
    await transports[1]?.answer();
    await expect(onHealthy.response).resolves.toMatchObject({ message: 'b' });
    await expect(waiting.response).resolves.toMatchObject({ message: 'c' });
    expect(pool.isUsingWorkers).toBe(true);
  });

  it('retires a worker that reports a fault, failing its running jobs with the reason', async () => {
    const { pool, transports } = createPool(1);
    const ticket = pool.submit('echo', echo('a'), { priority: 'visible' });
    await flushMicrotasks();

    transports[0]?.deliver({
      type: 'worker-fault',
      failure: { code: 'worker-failed', name: 'Error', message: 'lost a request' },
    });

    await expect(ticket.response).rejects.toMatchObject({
      failure: { code: 'worker-failed', message: 'lost a request' },
    });
    expect(transports[0]?.isTerminated).toBe(true);
    expect(pool.runningCount).toBe(0);
  });

  it('treats a reply that breaks the protocol as a worker failure', async () => {
    const { pool, transports } = createPool(1);
    const ticket = pool.submit('echo', echo('a'), { priority: 'visible' });
    await flushMicrotasks();

    transports[0]?.deliver({ type: 'job-result' });

    await expect(ticket.response).rejects.toMatchObject({ failure: { code: 'worker-failed' } });
  });

  it('ignores a well-formed reply for a job it did not send', async () => {
    const { pool, transports } = createPool(1);
    const ticket = pool.submit('echo', echo('a'), { priority: 'visible' });
    await flushMicrotasks();

    transports[0]?.deliver({ type: 'job-result', id: 999, payload: {} });
    await transports[0]?.answer();

    await expect(ticket.response).resolves.toMatchObject({ message: 'a' });
  });

  it('fails a job whose request cannot be posted, and keeps going', async () => {
    const { pool, transports } = createPool(1);
    transports[0]?.failNextPost(new Error('could not be cloned'));
    const unpostable = pool.submit('echo', echo('a'), { priority: 'visible' });
    const next = pool.submit('echo', echo('b'), { priority: 'visible' });
    await flushMicrotasks();

    await expect(unpostable.response).rejects.toMatchObject({
      failure: { code: 'invalid-request', message: 'could not be cloned' },
    });
    await transports[0]?.answer();
    await expect(next.response).resolves.toMatchObject({ message: 'b' });
  });

  it('falls back to the main thread once every worker has failed', async () => {
    const { pool, transports } = createPool(1);
    const lost = pool.submit('echo', echo('lost'), { priority: 'visible' });
    const queued = pool.submit('echo', echo('queued'), { priority: 'visible' });
    await flushMicrotasks();

    transports[0]?.crash();
    await expect(lost.response).rejects.toBeInstanceOf(JobFailedError);

    expect(pool.isUsingWorkers).toBe(false);
    expect(pool.drainMainThread(10, () => 0).jobsRun).toBe(1);
    await expect(queued.response).resolves.toMatchObject({ message: 'queued' });
  });
});

describe('WorkerPool main-thread fallback', () => {
  function createFallbackPool(
    fallbackHandlers: JobHandlers = createDefaultJobHandlers(),
  ): WorkerPool {
    const workerCount = chooseWorkerCount(detectWorkerEnvironment({}));
    return new WorkerPool({ workerCount, fallbackHandlers });
  }

  it('runs jobs only when drained, most urgent first, within the frame budget', async () => {
    let timeMs = 0;
    const order: string[] = [];
    const pool = createFallbackPool({
      echo: (request) => {
        order.push(request.message);
        timeMs += 3;
        return { response: request, transfer: [] };
      },
    });
    const tickets = ['prefetch', 'visible', 'near'].map((name) =>
      pool.submit('echo', echo(name), { priority: name as 'prefetch' | 'visible' | 'near' }),
    );
    await flushMicrotasks();
    expect(order).toEqual([]);

    const report = pool.drainMainThread(5, () => timeMs);

    expect(order).toEqual(['visible', 'near']);
    expect(report).toEqual({ jobsRun: 2, elapsedMs: 6, jobsRemaining: 1 });
    await expect(tickets[1]?.response).resolves.toMatchObject({ message: 'visible' });
    pool.drainMainThread(5, () => timeMs);
    await expect(tickets[0]?.response).resolves.toMatchObject({ message: 'prefetch' });
  });

  it('runs the default handlers when none are given', async () => {
    const pool = createFallbackPool();
    const ticket = pool.submit('echo', echo('hello'), { priority: 'near' });

    pool.drainMainThread(Infinity, () => 0);

    expect(pool.isUsingWorkers).toBe(false);
    await expect(ticket.response).resolves.toMatchObject({ message: 'hello' });
  });

  it('cancels a job whose asynchronous handler has already started', async () => {
    const pool = createFallbackPool({
      echo: async (request) => {
        await Promise.resolve();
        return { response: request, transfer: [] };
      },
    });
    const ticket = pool.submit('echo', echo('slow'), { priority: 'visible' });
    pool.drainMainThread(10, () => 0);

    expect(pool.cancel(ticket.id)).toBe(true);
    await flushMicrotasks();

    await expect(ticket.response).rejects.toBeInstanceOf(JobCancelledError);
    expect(pool.runningCount).toBe(0);
  });

  it('does not run jobs on the main thread while workers are serving them', async () => {
    const { pool, transports } = createPool(1);
    pool.submit('echo', echo('a'), { priority: 'visible' });
    pool.submit('echo', echo('b'), { priority: 'visible' });
    await flushMicrotasks();

    expect(pool.drainMainThread(10, () => 0)).toEqual({
      jobsRun: 0,
      elapsedMs: 0,
      jobsRemaining: 1,
    });
    expect(postedMessages(transports[0])).toEqual(['a']);
  });
});

describe('WorkerPool lifecycle', () => {
  it('terminates its workers and rejects every pending and running job', async () => {
    const { pool, transports } = createPool(1);
    const running = pool.submit('echo', echo('a'), { priority: 'visible' });
    const pending = pool.submit('echo', echo('b'), { priority: 'visible' });
    await flushMicrotasks();

    pool.terminate();

    await expect(running.response).rejects.toBeInstanceOf(JobCancelledError);
    await expect(pending.response).rejects.toBeInstanceOf(JobCancelledError);
    expect(transports[0]?.isTerminated).toBe(true);
    expect(() => pool.submit('echo', echo('c'), { priority: 'visible' })).toThrow(
      'The worker pool has been terminated.',
    );
  });

  it('rejects options it cannot run with', () => {
    const { createTransport } = createFakeTransports(1);

    const create = (options: Omit<WorkerPoolOptions, 'fallbackHandlers'>) => () =>
      new WorkerPool({ ...options, fallbackHandlers: HANDLERS });
    expect(create({ workerCount: -1 })).toThrow(RangeError);
    expect(create({ workerCount: 1 })).toThrow(RangeError);
    expect(create({ workerCount: 1, createTransport, maxInFlightPerWorker: 0 })).toThrow(
      RangeError,
    );
  });
});

import { describe, expect, it } from 'vitest';

import { createFakeTransports, flushMicrotasks } from './__fixtures__/fake-worker-transport.js';
import { createDefaultJobHandlers } from './default-job-handlers.js';
import type { JobHandlers } from './job-handlers.js';
import { createJobRequestMessage, isJobRequestMessage } from './protocol.js';
import { createWorkerEntry } from './worker-entry.js';
import { WorkerPool } from './worker-pool.js';

function echo(message: string): { message: string; bytes: ArrayBuffer } {
  return { message, bytes: new ArrayBuffer(0) };
}

function createPool(workerCount: number) {
  const { transports, createTransport } = createFakeTransports(workerCount);
  const pool = new WorkerPool({
    workerCount,
    maxInFlightPerWorker: 1,
    createTransport,
    fallbackHandlers: createDefaultJobHandlers(),
  });
  return { pool, transports };
}

describe('sticky job resources', () => {
  it('posts the same key exactly once to each of two workers over six jobs', async () => {
    const { pool, transports } = createPool(2);
    const bytes = new Uint8Array([3, 1, 4, 1]).buffer;
    const tickets = Array.from({ length: 6 }, (slot, index) =>
      pool.submit('echo', echo(String(index)), {
        priority: 'visible',
        resources: [{ key: 'font-a', bytes }],
      }),
    );

    await flushMicrotasks();
    for (let round = 0; round < 3; round += 1) {
      await transports[0]?.answer();
      await transports[1]?.answer();
      await flushMicrotasks();
    }

    expect(transports.map((transport) => transport.posted.length)).toEqual([3, 3]);
    for (const transport of transports) {
      expect(transport.posted[0]?.message.resources).toEqual([{ key: 'font-a', bytes }]);
      expect(transport.posted.slice(1).map(({ message }) => message.resources)).toEqual([
        undefined,
        undefined,
      ]);
    }
    await Promise.all(tickets.map((ticket) => ticket.response));
    pool.terminate();
  });

  it('keeps the caller buffer usable and leaves resource bytes out of transfer lists', async () => {
    const { pool, transports } = createPool(1);
    const bytes = new Uint8Array([7, 8, 9]).buffer;
    const request = echo('with transfer');
    const ticket = pool.submit('echo', request, {
      priority: 'visible',
      transfer: [request.bytes],
      resources: [{ key: 'font-a', bytes }],
    });

    await flushMicrotasks();

    expect(transports[0]?.posted[0]?.message.resources).toEqual([{ key: 'font-a', bytes }]);
    expect(transports[0]?.posted[0]?.transfer).toEqual([request.bytes]);
    expect(transports[0]?.posted[0]?.transfer).not.toContain(bytes);
    expect(bytes.byteLength).toBe(3);
    expect([...new Uint8Array(bytes)]).toEqual([7, 8, 9]);

    await transports[0]?.answer();
    await ticket.response;
    pool.terminate();
  });

  it('posts two distinct keys once each to the same worker', async () => {
    const { pool, transports } = createPool(1);
    const first = { key: 'font-a', bytes: new Uint8Array([1]).buffer };
    const second = { key: 'font-b', bytes: new Uint8Array([2]).buffer };
    const tickets = [first, second, first, second].map((resource, index) =>
      pool.submit('echo', echo(String(index)), {
        priority: 'visible',
        resources: [resource],
      }),
    );

    await flushMicrotasks();
    const jobCount = tickets.length;
    for (let answered = 0; answered < jobCount; answered += 1) {
      await transports[0]?.answer();
      await flushMicrotasks();
    }

    expect(transports[0]?.posted.map(({ message }) => message.resources)).toEqual([
      [first],
      [second],
      undefined,
      undefined,
    ]);
    await Promise.all(tickets.map((ticket) => ticket.response));
    pool.terminate();
  });

  it('attaches a queued job resource when that job is first posted', async () => {
    const { pool, transports } = createPool(1);
    const blocker = pool.submit('echo', echo('blocker'), { priority: 'visible' });
    const bytes = new Uint8Array([5]).buffer;
    const queued = pool.submit('echo', echo('queued'), {
      priority: 'visible',
      resources: [{ key: 'font-a', bytes }],
    });

    await flushMicrotasks();
    expect(transports[0]?.posted).toHaveLength(1);
    expect(pool.pendingCount).toBe(1);

    await transports[0]?.answer();
    await flushMicrotasks();

    expect(transports[0]?.posted[1]?.message.resources).toEqual([{ key: 'font-a', bytes }]);
    await transports[0]?.answer();
    await Promise.all([blocker.response, queued.response]);
    pool.terminate();
  });

  it('lets a main-thread fallback handler read its own job resource', async () => {
    const bytes = new Uint8Array([11, 12]).buffer;
    let seen: ArrayBuffer | undefined;
    const handlers: JobHandlers = {
      echo: (request, context) => {
        seen = context.resource('font-a');
        return { response: request, transfer: [] };
      },
    };
    const pool = new WorkerPool({ workerCount: 0, fallbackHandlers: handlers });
    const ticket = pool.submit('echo', echo('fallback'), {
      priority: 'visible',
      resources: [{ key: 'font-a', bytes }],
    });

    expect(pool.drainMainThread(Infinity, () => 0).jobsRun).toBe(1);
    await ticket.response;
    expect(seen).toBe(bytes);
    pool.terminate();
  });

  it('lets a queued job read its resource after the last worker retires', async () => {
    const bytes = new Uint8Array([23]).buffer;
    let seen: ArrayBuffer | undefined;
    const handlers: JobHandlers = {
      echo: (request, context) => {
        seen = context.resource('font-a');
        return { response: request, transfer: [] };
      },
    };
    const { transports, createTransport } = createFakeTransports(1);
    const pool = new WorkerPool({
      workerCount: 1,
      maxInFlightPerWorker: 1,
      createTransport,
      fallbackHandlers: handlers,
    });
    const lost = pool.submit('echo', echo('lost'), { priority: 'visible' });
    const queued = pool.submit('echo', echo('queued'), {
      priority: 'visible',
      resources: [{ key: 'font-a', bytes }],
    });

    await flushMicrotasks();
    transports[0]?.crash();
    await expect(lost.response).rejects.toThrow();
    expect(pool.drainMainThread(Infinity, () => 0).jobsRun).toBe(1);
    await queued.response;
    expect(seen).toBe(bytes);
    pool.terminate();
  });
});

describe('job resource protocol and worker entry', () => {
  it('omits empty resources and validates only arrays of keyed ArrayBuffers', () => {
    const payload = echo('validate');
    const without = createJobRequestMessage(1, 'echo', payload);
    const empty = createJobRequestMessage(2, 'echo', payload, []);
    const withBytes = createJobRequestMessage(3, 'echo', payload, [
      { key: 'font-a', bytes: new ArrayBuffer(2) },
    ]);

    expect(without).not.toHaveProperty('resources');
    expect(empty).not.toHaveProperty('resources');
    expect(isJobRequestMessage(without)).toBe(true);
    expect(isJobRequestMessage(withBytes)).toBe(true);
    for (const resources of [
      null,
      {},
      'font-a',
      [{ bytes: new ArrayBuffer(2) }],
      [{ key: 'font-a', bytes: [1, 2] }],
    ]) {
      expect(isJobRequestMessage({ ...without, resources })).toBe(false);
    }
  });

  it('serves a resource to the carrying job and a later job on the same entry', async () => {
    const bytes = new Uint8Array([13, 21]).buffer;
    const seen: (ArrayBuffer | undefined)[] = [];
    const handlers: JobHandlers = {
      echo: (request, context) => {
        seen.push(context.resource('font-a'));
        return { response: request, transfer: [] };
      },
    };
    const entry = createWorkerEntry(handlers);
    const replies: unknown[] = [];
    const post = (message: unknown): void => {
      replies.push(message);
    };

    await entry.onMessage(
      createJobRequestMessage(1, 'echo', echo('first'), [{ key: 'font-a', bytes }]),
      post,
    );
    await entry.onMessage(createJobRequestMessage(2, 'echo', echo('later')), post);

    expect(seen).toEqual([bytes, bytes]);
    expect(replies).toMatchObject([
      { type: 'job-result', id: 1 },
      { type: 'job-result', id: 2 },
    ]);
  });
});

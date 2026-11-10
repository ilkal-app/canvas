import { describe, expect, it } from 'vitest';

import { flushMicrotasks } from './__fixtures__/fake-worker-transport.js';
import { createDefaultJobHandlers } from './default-job-handlers.js';
import {
  createWebWorkerTransport,
  serveWorkerEntry,
  type WebWorkerEntry,
} from './web-worker/web-worker-transport.js';
import { createWorkerEntry } from './worker-entry.js';
import { WorkerPool } from './worker-pool.js';
import type { WorkerTransport } from './worker-transport.js';

// Vitest runs in Node, so these tests use a fake channel. Jobs round-trip through real module
// workers, with their buffers detached on the sending side, in the golden harness:
// tooling/golden/harness/specs/job-workers.spec.ts.

type Listener = (event: { data: unknown }) => void;

/**
 * One end of a fake `Worker`/`self` channel. What it posts reaches the other end's `message`
 * listeners in a later microtask; transfer lists are recorded rather than enforced, since
 * detaching buffers is the browser's job.
 */
class FakeMessageEndpoint {
  /** Every transfer list this end posted. */
  readonly transfers: unknown[][] = [];
  peer: FakeMessageEndpoint | undefined;
  private readonly listeners = new Map<string, Listener[]>();
  private postFailure: Error | undefined;
  private isNextDeliveryCorrupt = false;

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(data: unknown, transfer: unknown[]): void {
    const failure = this.postFailure;
    this.postFailure = undefined;
    if (failure !== undefined) throw failure;
    this.transfers.push(transfer);
    const type = this.isNextDeliveryCorrupt ? 'messageerror' : 'message';
    this.isNextDeliveryCorrupt = false;
    void Promise.resolve().then(() => {
      this.peer?.emit(type, type === 'message' ? data : null);
    });
  }

  terminate(): void {
    this.listeners.clear();
  }

  /**
   * Makes the next `postMessage` throw, as it does with a DataCloneError.
   *
   * @param error - The error to throw.
   */
  failNextPost(error: Error): void {
    this.postFailure = error;
  }

  /** Makes the next message arrive as a `messageerror`: the receiver cannot deserialise it. */
  corruptNextDelivery(): void {
    this.isNextDeliveryCorrupt = true;
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

/**
 * Starts a one-worker pool whose worker serves the default handlers over a fake channel.
 *
 * @returns The pool and both ends of the channel.
 */
function createServedPool(): {
  pool: WorkerPool;
  worker: FakeMessageEndpoint;
  scope: FakeMessageEndpoint;
} {
  const worker = new FakeMessageEndpoint();
  const scope = new FakeMessageEndpoint();
  worker.peer = scope;
  scope.peer = worker;
  serveWorkerEntry(scope, createWorkerEntry(createDefaultJobHandlers()));
  const pool = new WorkerPool({
    workerCount: 1,
    maxInFlightPerWorker: 1,
    createTransport: () => createWebWorkerTransport(worker),
    fallbackHandlers: createDefaultJobHandlers(),
  });
  return { pool, worker, scope };
}

describe('the Web Worker adapters', () => {
  it('fit the pool’s transport and entry contracts', () => {
    // Compile-time checks: the web-worker project restates these shapes and must stay
    // assignable. (Without the WebWorker lib the core cannot name `Worker`, so the fakes
    // need no cast; the return types are what is checked.)
    const transport: WorkerTransport = createWebWorkerTransport(new FakeMessageEndpoint());
    const entry: WebWorkerEntry = createWorkerEntry(createDefaultJobHandlers());

    expect(typeof transport.post).toBe('function');
    expect(typeof entry.onMessage).toBe('function');
  });

  it('round-trip an echo job from the pool through a worker, transfer lists included', async () => {
    const { pool, worker, scope } = createServedPool();
    const bytes = new ArrayBuffer(16);

    const ticket = pool.submit(
      'echo',
      { message: 'ping', bytes },
      { priority: 'visible', transfer: [bytes] },
    );
    await flushMicrotasks();

    await expect(ticket.response).resolves.toEqual({ message: 'ping', bytes });
    expect(worker.transfers).toEqual([[bytes]]);
    expect(scope.transfers).toEqual([[bytes]]);
  });

  it('fail a job whose reply the worker cannot post, and free its slot', async () => {
    const { pool, scope } = createServedPool();
    const cloneError = new Error('An ArrayBuffer is detached and could not be cloned.');
    cloneError.name = 'DataCloneError';
    scope.failNextPost(cloneError);
    const bytes = new ArrayBuffer(4);

    const unpostable = pool.submit('echo', { message: 'a', bytes }, { priority: 'visible' });
    const next = pool.submit('echo', { message: 'b', bytes }, { priority: 'visible' });
    await flushMicrotasks();

    await expect(unpostable.response).rejects.toMatchObject({
      failure: { code: 'handler-failed', name: 'DataCloneError' },
    });
    await flushMicrotasks();
    await expect(next.response).resolves.toMatchObject({ message: 'b' });
    expect(pool.runningCount).toBe(0);
    expect(pool.isUsingWorkers).toBe(true);
  });

  it('retire the worker when it cannot deserialise a request, so its job does not hang', async () => {
    const { pool, worker } = createServedPool();
    worker.corruptNextDelivery();

    const ticket = pool.submit(
      'echo',
      { message: 'a', bytes: new ArrayBuffer(4) },
      { priority: 'visible' },
    );
    await flushMicrotasks();

    await expect(ticket.response).rejects.toMatchObject({ failure: { code: 'worker-failed' } });
    expect(pool.runningCount).toBe(0);
    expect(pool.isUsingWorkers).toBe(false);
  });
});

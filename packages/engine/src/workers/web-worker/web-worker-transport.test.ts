import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWebWorkerTransport,
  serveWorkerEntry,
  type PageLeaveScope,
} from './web-worker-transport.js';

/** The fields of the events the fakes dispatch: a message's data, an error event's details. */
interface FakeEvent {
  data?: unknown;
  message?: string;
  filename?: string;
  lineno?: number;
  error?: unknown;
}

type Listener = (event: FakeEvent) => void;

/** A stand-in for a `Worker` or a worker's `self`: records posts, dispatches events on demand. */
class FakeEndpoint {
  readonly posted: { data: unknown; transfer: unknown[] }[] = [];
  isTerminated = false;
  private postFailure: Error | undefined;
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((each) => each !== listener),
    );
  }

  postMessage(data: unknown, transfer: unknown[]): void {
    const failure = this.postFailure;
    this.postFailure = undefined;
    if (failure !== undefined) throw failure;
    this.posted.push({ data, transfer });
  }

  failNextPost(error: Error): void {
    this.postFailure = error;
  }

  terminate(): void {
    this.isTerminated = true;
  }

  emit(type: string, event: FakeEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function createConnectedTransport(page: FakeEndpoint = new FakeEndpoint()): {
  endpoint: FakeEndpoint;
  transport: ReturnType<typeof createWebWorkerTransport>;
  received: unknown[];
  failures: Error[];
} {
  const endpoint = new FakeEndpoint();
  const transport = createWebWorkerTransport(endpoint as unknown as Worker, page);
  const received: unknown[] = [];
  const failures: Error[] = [];
  transport.connect({
    onMessage: (data) => received.push(data),
    onFailure: (error) => failures.push(error),
  });
  return { endpoint, transport, received, failures };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createWebWorkerTransport', () => {
  it('posts a request with its transfer list', () => {
    const { endpoint, transport } = createConnectedTransport();
    const bytes = new ArrayBuffer(8);

    transport.post({ type: 'job-request', id: 1 }, [bytes]);

    expect(endpoint.posted).toEqual([{ data: { type: 'job-request', id: 1 }, transfer: [bytes] }]);
  });

  it('delivers the data of each message the worker posts', () => {
    const { endpoint, received } = createConnectedTransport();

    endpoint.emit('message', { data: { type: 'job-result', id: 1 } });

    expect(received).toEqual([{ type: 'job-result', id: 1 }]);
  });

  it('reports an error event as a failure of the worker', () => {
    const { endpoint, failures } = createConnectedTransport();

    endpoint.emit('error', { message: 'Uncaught SyntaxError' });

    expect(failures.map((error) => error.message)).toEqual([
      'The job worker failed: Uncaught SyntaxError',
    ]);
  });

  it('names the script, the line and the error of an error event that has them', () => {
    const { endpoint, failures } = createConnectedTransport();

    endpoint.emit('error', {
      message: 'Uncaught SyntaxError: Unexpected token',
      filename: 'http://127.0.0.1:5173/src/jobs/job-worker.ts',
      lineno: 12,
      error: new SyntaxError('Unexpected token'),
    });

    expect(failures.map((error) => error.message)).toEqual([
      'The job worker failed at http://127.0.0.1:5173/src/jobs/job-worker.ts:12: ' +
        'SyntaxError: Unexpected token',
    ]);
  });

  it('names the script without a line when the event has no line', () => {
    const { endpoint, failures } = createConnectedTransport();

    endpoint.emit('error', {
      message: 'Uncaught Error: boom',
      filename: 'job-worker.js',
      lineno: 0,
    });

    expect(failures.map((error) => error.message)).toEqual([
      'The job worker failed at job-worker.js: Uncaught Error: boom',
    ]);
  });

  it('describes a thrown value that is not an Error by its type and JSON', () => {
    const { endpoint, failures } = createConnectedTransport();

    endpoint.emit('error', { message: 'Uncaught', error: { code: 7 } });
    endpoint.emit('error', { message: 'Uncaught', error: 7n });

    expect(failures.map((error) => error.message)).toEqual([
      'The job worker failed: object {"code":7}',
      'The job worker failed: bigint',
    ]);
  });

  it('says the script could not be loaded a second after an error event with no details', () => {
    // A module worker whose script fails to load fires a plain `Event`: no message, file or error.
    vi.useFakeTimers();
    const { endpoint, failures } = createConnectedTransport();

    endpoint.emit('error', {});
    vi.advanceTimersByTime(999);
    expect(failures).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(failures.map((error) => error.message)).toEqual([
      'The job worker failed: the worker script could not be loaded.',
    ]);
  });

  it('drops a load failure when the page leaves within that second', () => {
    // Safari fails a loading worker as the page starts to leave, before `pagehide`.
    vi.useFakeTimers();
    const page = new FakeEndpoint();
    const { endpoint, failures } = createConnectedTransport(page);

    endpoint.emit('error', {});
    page.emit('pagehide', {});
    vi.advanceTimersByTime(1000);

    expect(failures).toEqual([]);
  });

  it('drops a load failure when the worker is terminated within that second, and stops waiting', () => {
    vi.useFakeTimers();
    const page = new FakeEndpoint();
    const { endpoint, transport, failures } = createConnectedTransport(page);

    endpoint.emit('error', {});
    transport.terminate();

    expect(vi.getTimerCount()).toBe(0);
    expect(page.listenerCount('pagehide')).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(failures).toEqual([]);
  });

  it('touches the page scope only while a load failure waits', () => {
    // A pool in Node, whose global scope has no event listeners, terminates its workers too.
    const endpoint = new FakeEndpoint();
    const transport = createWebWorkerTransport(endpoint as unknown as Worker, {} as PageLeaveScope);
    transport.connect({ onMessage: () => undefined, onFailure: () => undefined });

    expect(() => {
      transport.terminate();
    }).not.toThrow();
    expect(endpoint.isTerminated).toBe(true);
  });

  it('waits for the first of two load failures, once', () => {
    vi.useFakeTimers();
    const page = new FakeEndpoint();
    const { endpoint, failures } = createConnectedTransport(page);

    endpoint.emit('error', {});
    endpoint.emit('error', {});

    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(failures).toHaveLength(1);
    expect(page.listenerCount('pagehide')).toBe(0);
  });

  it('reports an uncaught error at once, whether or not the page then leaves', () => {
    vi.useFakeTimers();
    const page = new FakeEndpoint();
    const { endpoint, failures } = createConnectedTransport(page);

    endpoint.emit('error', { message: 'Uncaught Error: boom' });
    page.emit('pagehide', {});

    expect(failures.map((error) => error.message)).toEqual([
      'The job worker failed: Uncaught Error: boom',
    ]);
  });

  it('reports a message that could not be deserialised as a failure of the worker', () => {
    const { endpoint, failures } = createConnectedTransport();

    endpoint.emit('messageerror', { data: null });

    expect(failures.map((error) => error.message)).toEqual([
      'A message from the job worker could not be deserialised.',
    ]);
  });

  it('terminates the worker and delivers nothing afterwards', () => {
    const { endpoint, transport, received, failures } = createConnectedTransport();

    transport.terminate();
    endpoint.emit('message', { data: {} });
    endpoint.emit('error', { message: 'late' });

    expect(endpoint.isTerminated).toBe(true);
    expect(received).toEqual([]);
    expect(failures).toEqual([]);
  });
});

describe('serveWorkerEntry', () => {
  it('hands each message to the entry with a poster that posts on the scope', () => {
    const scope = new FakeEndpoint();
    const bytes = new ArrayBuffer(4);
    serveWorkerEntry(scope as unknown as DedicatedWorkerGlobalScope, {
      onMessage: (data, post) => {
        post({ echoed: data }, [bytes]);
        return Promise.resolve();
      },
      onMessageError: () => undefined,
    });

    scope.emit('message', { data: 'ping' });

    expect(scope.posted).toEqual([{ data: { echoed: 'ping' }, transfer: [bytes] }]);
  });

  it('lets the poster throw into the entry, which decides how to recover', () => {
    const scope = new FakeEndpoint();
    scope.failNextPost(new Error('could not be cloned'));
    const caught: unknown[] = [];
    serveWorkerEntry(scope as unknown as DedicatedWorkerGlobalScope, {
      onMessage: (data, post) => {
        try {
          post(data, []);
        } catch (error) {
          caught.push(error);
        }
        return Promise.resolve();
      },
      onMessageError: () => undefined,
    });

    scope.emit('message', { data: 'ping' });

    expect(caught).toEqual([new Error('could not be cloned')]);
    expect(scope.posted).toEqual([]);
  });

  it('tells the entry when a request could not be deserialised', () => {
    const scope = new FakeEndpoint();
    serveWorkerEntry(scope as unknown as DedicatedWorkerGlobalScope, {
      onMessage: () => Promise.resolve(),
      onMessageError: (post) => {
        post({ type: 'worker-fault' }, []);
      },
    });

    scope.emit('messageerror', { data: null });

    expect(scope.posted).toEqual([{ data: { type: 'worker-fault' }, transfer: [] }]);
  });
});

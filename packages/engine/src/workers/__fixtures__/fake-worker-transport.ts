import { createDefaultJobHandlers } from '../default-job-handlers.js';
import { runJob, type JobHandlers } from '../job-handlers.js';
import type { JobRequestMessage, PostedMessage, TransferList } from '../protocol.js';
import type {
  WorkerTransport,
  WorkerTransportFactory,
  WorkerTransportListener,
} from '../worker-transport.js';

/**
 * An in-memory stand-in for a job worker: it records every request posted to it and answers
 * only when the test says so, running the real handlers through `runJob`, so tests control
 * exactly when each reply arrives.
 */
export class FakeWorkerTransport implements WorkerTransport {
  /** Every request posted, in order, with its transfer list. */
  readonly posted: PostedMessage<JobRequestMessage>[] = [];
  /** Whether the pool terminated this worker. */
  isTerminated = false;
  private readonly unanswered: JobRequestMessage[] = [];
  private readonly handlers: JobHandlers;
  private listener: WorkerTransportListener | undefined;
  private postError: Error | undefined;

  /**
   * Creates a fake worker.
   *
   * @param handlers - The handlers it runs; the default set when omitted.
   */
  constructor(handlers: JobHandlers = createDefaultJobHandlers()) {
    this.handlers = handlers;
  }

  /**
   * The ids of requests posted and not yet answered.
   *
   * @returns The ids, in posting order.
   */
  get unansweredIds(): number[] {
    return this.unanswered.map(({ id }) => id);
  }

  /**
   * Records the pool's listener.
   *
   * @param listener - Where replies and failures go.
   * @throws {Error} When connected twice.
   */
  connect(listener: WorkerTransportListener): void {
    if (this.listener !== undefined) throw new Error('A transport is connected once.');
    this.listener = listener;
  }

  /**
   * Records a request, or throws the error set by {@link FakeWorkerTransport.failNextPost}.
   *
   * @param message - The request.
   * @param transfer - Its transfer list.
   * @throws {Error} When the fake is terminated or told to fail this post.
   */
  post(message: JobRequestMessage, transfer: TransferList): void {
    if (this.isTerminated) throw new Error('Posted to a terminated worker.');
    if (this.postError !== undefined) {
      const error = this.postError;
      this.postError = undefined;
      throw error;
    }
    this.posted.push({ message, transfer });
    this.unanswered.push(message);
  }

  /** Marks the fake terminated. */
  terminate(): void {
    this.isTerminated = true;
  }

  /**
   * Makes the next {@link FakeWorkerTransport.post} throw, as `postMessage` does when a
   * payload cannot be cloned.
   *
   * @param error - The error to throw.
   */
  failNextPost(error: Error): void {
    this.postError = error;
  }

  /**
   * Runs an unanswered request through the handlers and delivers the reply.
   *
   * @param id - The request to answer; the oldest unanswered one when omitted.
   * @throws {Error} When there is no such unanswered request.
   */
  async answer(id?: number): Promise<void> {
    const index = id === undefined ? 0 : this.unanswered.findIndex((request) => request.id === id);
    if (index < 0 || index >= this.unanswered.length) {
      throw new Error('No such unanswered request.');
    }
    const [request] = this.unanswered.splice(index, 1);
    if (request === undefined) throw new Error('No such unanswered request.');
    const reply = await runJob(this.handlers, request);
    this.deliver(reply.message);
  }

  /**
   * Delivers raw data as if the worker had posted it.
   *
   * @param data - The message data.
   */
  deliver(data: unknown): void {
    this.listener?.onMessage(data);
  }

  /**
   * Reports the worker as failed, as a real worker's `error` event would.
   *
   * @param error - What went wrong.
   */
  crash(error: Error = new Error('The worker crashed.')): void {
    this.listener?.onFailure(error);
  }
}

/**
 * Creates `count` fake workers and a factory that hands them to a pool in order.
 *
 * @param count - How many fake workers to create.
 * @param handlers - The handlers they run; the default set when omitted.
 * @returns The fakes and the factory.
 * @throws {Error} From the factory, when asked for a worker index beyond `count`.
 */
export function createFakeTransports(
  count: number,
  handlers?: JobHandlers,
): { transports: FakeWorkerTransport[]; createTransport: WorkerTransportFactory } {
  const transports = Array.from({ length: count }, () => new FakeWorkerTransport(handlers));
  const createTransport: WorkerTransportFactory = (workerIndex) => {
    const transport = transports[workerIndex];
    if (transport === undefined) throw new Error(`No fake worker ${String(workerIndex)}.`);
    return transport;
  };
  return { transports, createTransport };
}

/**
 * Lets pending promise callbacks run: the pool dispatches in a microtask, and fake replies
 * settle through a few promise hops.
 */
export async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

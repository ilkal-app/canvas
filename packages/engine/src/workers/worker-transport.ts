import type { JobRequestMessage, TransferList } from './protocol.js';

/** Receives what a worker sends back, and news of its failure. */
export interface WorkerTransportListener {
  /**
   * Called with the data of each message the worker posts. The data crossed a thread, so the
   * pool checks it before trusting it.
   *
   * @param data - The message data.
   */
  onMessage(data: unknown): void;
  /**
   * Called when the worker fails as a whole: its script did not load, it raised an uncaught
   * error, or a message from it could not be deserialised. Its in-flight jobs are lost.
   *
   * @param error - What went wrong.
   */
  onFailure(error: Error): void;
}

/**
 * One job worker as the `WorkerPool` sees it: a MessagePort-like channel that posts
 * requests with transfer lists and reports replies and failures. DOM-free, so the pool's
 * scheduling is unit-tested with an in-memory double; `createWebWorkerTransport` adapts a
 * real `Worker`.
 */
export interface WorkerTransport {
  /**
   * Starts delivering the worker's messages and failures. The pool calls it once, before
   * the first {@link WorkerTransport.post}.
   *
   * @param listener - Where to deliver them.
   */
  connect(listener: WorkerTransportListener): void;
  /**
   * Posts a request. The objects in `transfer` move to the worker and are unusable here
   * afterwards.
   *
   * @param message - The request.
   * @param transfer - Objects to transfer rather than copy.
   */
  post(message: JobRequestMessage, transfer: TransferList): void;
  /** Stops the worker at once; nothing more is delivered. */
  terminate(): void;
}

/**
 * Starts worker number `workerIndex` of a pool and returns its transport.
 *
 * @param workerIndex - The worker's index in the pool, from 0.
 * @returns The worker's transport, not yet connected.
 */
export type WorkerTransportFactory = (workerIndex: number) => WorkerTransport;

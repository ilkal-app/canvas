import type { TransferList } from '../workers/protocol.js';
import type { WorkerTransportListener } from '../workers/worker-transport.js';

import type { HostToWorkerMessage } from './host-protocol.js';

/**
 * The engine worker as the page sees it: the job pool's transport shape with host messages.
 * `createWebWorkerTransport(new Worker(url, { type: 'module' }))` adapts a real worker whose
 * script serves `createEngineWorkerEntry`.
 */
export interface EngineWorkerTransport {
  /**
   * Starts delivering the worker's messages and failures; called once, before the first post.
   *
   * @param listener - Where to deliver them.
   */
  connect(listener: WorkerTransportListener): void;
  /**
   * Posts a message; the objects in `transfer` move to the worker.
   *
   * @param message - The message.
   * @param transfer - Objects to transfer rather than copy.
   */
  post(message: HostToWorkerMessage, transfer: TransferList): void;
  /** Stops the worker at once, with its GPU context; nothing more is delivered. */
  terminate(): void;
}

import type { GpuCapabilities } from '../gpu/gpu-capabilities.js';

import {
  isWorkerToHostMessage,
  toHostError,
  type EngineInitMessage,
  type WorkerToHostMessage,
} from './host-protocol.js';
import type { EngineWorkerTransport } from './worker-engine-host.js';

/** What the worker's `engine-ready` said. */
export interface WorkerReady {
  readonly capabilities: GpuCapabilities;
  /** Worker clock origin minus page clock origin, ms: add it to a worker time. */
  readonly clockOffsetMs: number;
}

/**
 * Starts the worker and waits for `engine-ready`, rejecting (and terminating the worker) on a
 * failure before it.
 *
 * @param transport - The spawned worker.
 * @param init - The `engine-init` message: the canvas, the options and the image channel, the
 *   first and last transferred.
 * @param pageTimeOriginMs - The page's clock origin, ms since the epoch.
 * @param onMessage - Where messages after `engine-ready` go.
 * @param onFailure - Where worker failures after `engine-ready` go.
 * @returns What the worker reported when ready.
 */
export function startWorker(
  transport: EngineWorkerTransport,
  init: EngineInitMessage,
  pageTimeOriginMs: number,
  onMessage: (message: WorkerToHostMessage | undefined) => void,
  onFailure: (error: Error) => void,
): Promise<WorkerReady> {
  return new Promise((resolve, reject) => {
    let isReady = false;
    const failStart = (error: Error): void => {
      transport.terminate();
      reject(error);
    };
    transport.connect({
      onMessage: (data) => {
        const message = isWorkerToHostMessage(data) ? data : undefined;
        if (isReady) {
          onMessage(message);
        } else if (message?.type === 'engine-ready') {
          isReady = true;
          const clockOffsetMs = message.timeOriginMs - pageTimeOriginMs;
          resolve({ capabilities: message.capabilities, clockOffsetMs });
        } else if (message?.type === 'engine-failure') {
          failStart(toHostError(message.failure));
        }
      },
      onFailure: (error) => {
        if (isReady) onFailure(error);
        else failStart(error);
      },
    });
    try {
      const { canvas, imageChannel } = init;
      transport.post(init, imageChannel === undefined ? [canvas] : [canvas, imageChannel]);
    } catch (error) {
      failStart(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

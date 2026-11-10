// An engine worker in the test's own thread: the real worker entry behind a transport that
// structured-clones every message both ways (so anything that could not cross a real thread
// fails here too), transfers ArrayBuffers, and delivers in a later microtask. Modelled on the
// job pool's FakeWorkerTransport (../../workers/__fixtures__/fake-worker-transport.ts).
import { flushMicrotasks } from '../../workers/__fixtures__/fake-worker-transport.js';
import type { TransferList } from '../../workers/protocol.js';
import type { WorkerTransportListener } from '../../workers/worker-transport.js';
import {
  createEngineWorkerEntry,
  type EngineWorkerEntry,
  type EngineWorkerExtensions,
} from '../engine-worker-entry.js';
import type { HostToWorkerMessage } from '../host-protocol.js';
import type { EngineWorkerTransport } from '../worker-engine-host.js';

import { FakeHostPlatform } from './fake-host-platform.js';

/** The host's structured clone, typed here because the engine core compiles without DOM types. */
const cloneStructured = (
  globalThis as unknown as {
    structuredClone: <T>(value: T, options?: { transfer?: unknown[] }) => T;
  }
).structuredClone;

/**
 * Clones a message as `postMessage` would, moving the ArrayBuffers of its transfer list. Other
 * transferables (the canvas) are cloned as plain data, since the test has no real one.
 *
 * @param message - The message.
 * @param transfer - Its transfer list.
 * @returns The receiver's copy.
 */
export function cloneForPost<T>(message: T, transfer: TransferList): T {
  const buffers = transfer.filter((item) => item instanceof ArrayBuffer);
  return cloneStructured(message, { transfer: buffers });
}

/** The worker end, running the real `createEngineWorkerEntry` on a fake worker platform. */
export class InMemoryEngineWorker implements EngineWorkerTransport {
  /** The worker thread's platform: its frames run when the test says so. */
  readonly platform: FakeHostPlatform;
  /** Every message the worker received, as it received it. */
  readonly received: HostToWorkerMessage[] = [];
  /** The transfer list of each message, as the host posted it. */
  readonly transfers: TransferList[] = [];
  /** Whether the host terminated the worker. */
  isTerminated = false;
  private readonly entry: EngineWorkerEntry;
  private listener: WorkerTransportListener | undefined;

  /**
   * Creates the worker.
   *
   * @param workerTimeOriginMs - The worker clock's origin, ms since the epoch.
   * @param extensions - What the worker's script adds (its overlay layer).
   */
  constructor(workerTimeOriginMs = 1_000_500, extensions: EngineWorkerExtensions = {}) {
    this.platform = new FakeHostPlatform(workerTimeOriginMs);
    this.entry = createEngineWorkerEntry(this.platform, extensions);
  }

  /**
   * Records the host's listener.
   *
   * @param listener - Where the worker's messages go.
   */
  connect(listener: WorkerTransportListener): void {
    this.listener = listener;
  }

  /**
   * Clones and delivers a message to the worker entry in a later microtask.
   *
   * @param message - The message.
   * @param transfer - Its transfer list.
   * @throws {Error} When the worker was terminated, or the message cannot be cloned.
   */
  post(message: HostToWorkerMessage, transfer: TransferList): void {
    if (this.isTerminated) throw new Error('Posted to a terminated worker.');
    const copy = cloneForPost(message, transfer);
    this.transfers.push(transfer);
    void Promise.resolve().then(async () => {
      if (this.isTerminated) return;
      this.received.push(copy);
      await this.entry.onMessage(copy, (reply, replyTransfer) => {
        const replyCopy = cloneForPost(reply, replyTransfer);
        void Promise.resolve().then(() => {
          if (!this.isTerminated) this.listener?.onMessage(replyCopy);
        });
      });
    });
  }

  /** Stops delivering anything, both ways. */
  terminate(): void {
    this.isTerminated = true;
  }

  /**
   * Delivers raw data to the host as if the worker had posted it.
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
  crash(error: Error = new Error('The engine worker crashed.')): void {
    this.listener?.onFailure(error);
  }

  /**
   * Runs the worker's pending animation frames and lets every resulting message arrive.
   *
   * @param timeMs - The frame time on the worker's clock, ms.
   */
  async runFrame(timeMs: number): Promise<void> {
    await settle();
    this.platform.runFrame(timeMs);
    await settle();
  }
}

/** Lets every message in flight, and the promise hops behind it, arrive. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) await flushMicrotasks();
}

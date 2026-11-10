import type { EngineFrameReport } from './engine-host.js';

/** Ordered frame markers belonging to one host lifetime, shared by both transports. */
export class FrameAcknowledgements {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (index: number) => void; reject: (error: Error) => void }
  >();
  private isDestroyed = false;

  /**
   * Queues a marker after preceding host calls, registering before sending it.
   *
   * @param send - The transport's ordered marker call.
   * @returns The actual successful frame index.
   */
  request(send: (id: number) => void): Promise<number> {
    if (this.isDestroyed)
      return Promise.reject(new Error('The engine was destroyed before the frame was drawn.'));
    if (!Number.isSafeInteger(this.nextId))
      return Promise.reject(new RangeError('Frame acknowledgement ids exhausted.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        send(id);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Resolves only markers included in a successful frame, never a future host generation.
   *
   * @param report - The runtime's frame report.
   */
  acknowledge(report: EngineFrameReport): void {
    const id = report.acknowledgementId;
    if (
      id === undefined ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      id >= this.nextId ||
      !Number.isSafeInteger(report.frameIndex) ||
      report.frameIndex < 0
    )
      return;
    for (const [marker, pending] of this.pending) {
      if (marker > id) break;
      this.pending.delete(marker);
      pending.resolve(report.frameIndex);
    }
  }

  /**
   * Rejects current markers without reusing their ids, so late reports cannot release new work.
   *
   * @param error - The host fault.
   */
  reject(error: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const item of pending) item.reject(error);
  }

  /** Rejects outstanding and future requests after the host closes. */
  destroy(): void {
    this.isDestroyed = true;
    this.reject(new Error('The engine was destroyed before the frame was drawn.'));
  }
}

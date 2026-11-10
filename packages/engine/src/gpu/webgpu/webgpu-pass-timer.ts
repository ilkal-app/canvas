import type { GpuPassTiming } from '../gpu-backend.js';

import { timingsFromTimestamps } from './timestamp-timings.js';

/** Timed passes per submitted frame; later passes in the same frame go untimed. */
const MAX_TIMED_PASSES = 32;

/** Submitted frames whose timings may wait uncollected; later frames go untimed until collected. */
const MAX_UNCOLLECTED_FRAMES = 4;

const BYTES_PER_TIMESTAMP = 8;

interface PendingReadback {
  readonly labels: readonly string[];
  readonly buffer: GPUBuffer;
  mapped?: Promise<void>;
}

/**
 * Measures labelled passes with WebGPU `timestamp-query`: each pass
 * writes a begin and an end timestamp; at submit the query set is resolved and copied into a
 * mappable buffer, which `collect` reads once the GPU is done.
 */
export class WebGpuPassTimer {
  private readonly querySet: GPUQuerySet | undefined;
  private readonly resolveBuffer: GPUBuffer | undefined;
  private labels: string[] = [];
  private readonly submitted: PendingReadback[] = [];
  private readonly freeReadbacks: GPUBuffer[] = [];

  /**
   * Allocates the query set when the device has `timestamp-query`.
   *
   * @param device - The device whose passes are timed.
   * @param isSupported - Whether the device was created with `timestamp-query`.
   */
  constructor(
    private readonly device: GPUDevice,
    readonly isSupported: boolean,
  ) {
    if (!isSupported) {
      return;
    }
    const count = MAX_TIMED_PASSES * 2;
    this.querySet = device.createQuerySet({ label: 'pass timings', type: 'timestamp', count });
    this.resolveBuffer = device.createBuffer({
      label: 'pass timings resolve',
      size: count * BYTES_PER_TIMESTAMP,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
  }

  /**
   * The timestamp writes for a pass, when it is labelled and a query pair is free.
   *
   * @param label - The pass's timing label.
   * @returns The pass descriptor's `timestampWrites`, or `undefined` for an untimed pass.
   */
  timestampWrites(label: string | undefined): GPURenderPassTimestampWrites | undefined {
    const isFull =
      this.labels.length >= MAX_TIMED_PASSES || this.submitted.length >= MAX_UNCOLLECTED_FRAMES;
    if (!this.querySet || label === undefined || isFull) {
      return undefined;
    }
    const index = this.labels.length;
    this.labels.push(label);
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: 2 * index,
      endOfPassWriteIndex: 2 * index + 1,
    };
  }

  /**
   * Records the resolve and copy of this frame's timestamps; call before finishing the encoder.
   *
   * @param encoder - The frame's command encoder.
   */
  resolve(encoder: GPUCommandEncoder): void {
    if (!this.querySet || !this.resolveBuffer || this.labels.length === 0) {
      return;
    }
    const size = this.labels.length * 2 * BYTES_PER_TIMESTAMP;
    const buffer = this.acquireReadback();
    encoder.resolveQuerySet(this.querySet, 0, this.labels.length * 2, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, buffer, 0, size);
    this.submitted.push({ labels: this.labels, buffer });
    this.labels = [];
  }

  /** Starts mapping the readbacks just submitted; call right after `queue.submit`. */
  afterSubmit(): void {
    for (const readback of this.submitted) {
      readback.mapped ??= readback.buffer.mapAsync(GPUMapMode.READ);
    }
  }

  /**
   * Waits for every submitted frame's timestamps.
   *
   * @returns One timing per timed pass, in submission order.
   */
  async collect(): Promise<GpuPassTiming[]> {
    const readbacks = this.submitted.splice(0);
    const timings: GpuPassTiming[] = [];
    for (const { labels, buffer, mapped } of readbacks) {
      await mapped;
      const size = labels.length * 2 * BYTES_PER_TIMESTAMP;
      const timestamps = new BigUint64Array(buffer.getMappedRange(0, size).slice(0));
      buffer.unmap();
      this.freeReadbacks.push(buffer);
      timings.push(...timingsFromTimestamps(labels, timestamps));
    }
    return timings;
  }

  /** Frees the query set and every buffer. */
  destroy(): void {
    this.querySet?.destroy();
    this.resolveBuffer?.destroy();
    for (const buffer of this.freeReadbacks) {
      buffer.destroy();
    }
  }

  private acquireReadback(): GPUBuffer {
    return (
      this.freeReadbacks.pop() ??
      this.device.createBuffer({
        label: 'pass timings readback',
        size: MAX_TIMED_PASSES * 2 * BYTES_PER_TIMESTAMP,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
    );
  }
}

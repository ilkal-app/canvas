import type { BenchmarkSample } from '../diagnostics/stats-export.js';

import type { EnginePixels } from './engine-pixels.js';
import type { PreviewCertificate } from './scene-certificate.js';
import type { SceneProjection } from './scene-projection.js';

/** What each kind of read answers with. */
export interface WorkerReadValues {
  /** A preview certificate, or none while a contributor is unproven. */
  readonly certificate: PreviewCertificate | undefined;
  /** A projection, or none without a camera or spatial index. */
  readonly projection: SceneProjection | undefined;
  /** A rectangle of pixels. */
  readonly pixels: EnginePixels;
  /** A frame statistics summary. */
  readonly stats: BenchmarkSample;
}

/** A worker's answer to a read: its kind and value, or a failure. */
export type WorkerReadOutcome =
  | {
      [Kind in keyof WorkerReadValues]: {
        readonly kind: Kind;
        readonly value: WorkerReadValues[Kind];
      };
    }[keyof WorkerReadValues]
  | Error;

interface PendingRead {
  readonly kind: keyof WorkerReadValues;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

/**
 * The reads a worker engine host waits on (pixels, statistics, projections, certificates), by
 * the id their command carries to the worker and back. Main thread.
 */
export class WorkerReads {
  private readonly pending = new Map<number, PendingRead>();
  private nextId = 1;

  /**
   * Opens a read under a fresh id.
   *
   * @param kind - What the read answers with.
   * @param send - Queues the read's command, with its id.
   * @returns Settles with the worker's answer.
   */
  open<Kind extends keyof WorkerReadValues>(
    kind: Kind,
    send: (id: number) => void,
  ): Promise<WorkerReadValues[Kind]> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        kind,
        resolve: (value) => {
          resolve(value as WorkerReadValues[Kind]);
        },
        reject,
      });
      send(id);
    });
  }

  /**
   * Settles one read; an unknown id is ignored, an answer of the wrong kind rejects.
   *
   * @param id - The read's id.
   * @param outcome - The answer.
   */
  settle(id: number, outcome: WorkerReadOutcome): void {
    const read = this.pending.get(id);
    if (read === undefined) return;
    this.pending.delete(id);
    if (outcome instanceof Error) read.reject(outcome);
    else if (outcome.kind === read.kind) read.resolve(outcome.value);
    else read.reject(new TypeError(`The engine worker answered a ${read.kind} read wrongly.`));
  }

  /**
   * Rejects every waiting read.
   *
   * @param error - Why.
   */
  rejectAll(error: Error): void {
    const reads = [...this.pending.values()];
    this.pending.clear();
    for (const read of reads) read.reject(error);
  }
}

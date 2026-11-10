// The worker pool's private bookkeeping: the jobs it holds and its workers' slots.

import type { JobKind, JobResponse } from './job-kinds.js';
import type { JobResource, SubmittedJob } from './job-submission.js';
import type { TransferList } from './protocol.js';
import type { WorkerTransport } from './worker-transport.js';

/** A job the pool holds: what to run and how to settle its ticket. */
export interface PoolJob {
  readonly job: SubmittedJob;
  readonly transfer: TransferList;
  /** What its handler may read through its context; sent to each worker once per key. */
  readonly resources: readonly JobResource[];
  readonly resolve: (response: JobResponse<JobKind>) => void;
  readonly reject: (error: Error) => void;
}

/** A job posted to a worker (or started on the main thread) whose reply has not arrived. */
export interface RunningJob {
  readonly poolJob: PoolJob;
  /** The worker running it; `undefined` on the main thread. */
  readonly workerIndex: number | undefined;
  isCancelled: boolean;
}

/**
 *
 */
export interface WorkerSlot {
  readonly transport: WorkerTransport;
  inFlightCount: number;
  isAlive: boolean;
  /** The resource keys this worker has been sent, so later jobs carry none of their bytes. */
  readonly sentResourceKeys: Set<string>;
}

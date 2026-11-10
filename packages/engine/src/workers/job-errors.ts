import type { JobId } from './job-id.js';
import type { JobKind } from './job-kinds.js';
import type { JobFailure } from './protocol.js';

/**
 * Rejects a job's promise when the job was cancelled (by id, or because its pool was
 * terminated) before its result was delivered. Expected in normal operation: the engine
 * cancels work for objects that changed again or left the viewport.
 */
export class JobCancelledError extends Error {
  /** Always `JobCancelledError`. */
  override readonly name = 'JobCancelledError';
  /** The cancelled job. */
  readonly jobId: JobId;

  /**
   * Creates the error.
   *
   * @param jobId - The cancelled job.
   * @param reason - Why it was cancelled, for the message.
   */
  constructor(jobId: JobId, reason = 'it was cancelled') {
    super(`Job ${String(jobId)} did not complete: ${reason}.`);
    this.jobId = jobId;
  }
}

/** Rejects a job's promise when the job failed; `failure` says why (see `JobFailureCode`). */
export class JobFailedError extends Error {
  /** Always `JobFailedError`. */
  override readonly name = 'JobFailedError';
  /** The failed job. */
  readonly jobId: JobId;
  /** The failed job's kind. */
  readonly kind: JobKind;
  /** The structured failure, as the worker (or the pool, for `worker-failed`) reported it. */
  readonly failure: JobFailure;

  /**
   * Creates the error.
   *
   * @param jobId - The failed job.
   * @param kind - Its kind.
   * @param failure - What went wrong.
   */
  constructor(jobId: JobId, kind: JobKind, failure: JobFailure) {
    super(`${kind} job ${String(jobId)} failed (${failure.code}): ${failure.message}`);
    this.jobId = jobId;
    this.kind = kind;
    this.failure = failure;
  }
}

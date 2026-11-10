import type { JobId } from './job-id.js';
import type { JobKind, JobRequest, JobResponse } from './job-kinds.js';
import type { JobPriority } from './job-priority.js';
import type { TransferList } from './protocol.js';

/**
 * Bytes a job's handler may read by key through its context, such as a font file.
 * The pool sends a key's bytes to each worker once, as a copy, so a key must always name the
 * same bytes: give changed bytes a new key (as `LoadedFontFace.fontKey` does).
 */
export interface JobResource {
  /** Names the bytes; the same key always means the same bytes. */
  readonly key: string;
  /** The bytes. Copied to a worker, never transferred; the caller must not change them. */
  readonly bytes: ArrayBuffer;
}

/** How to schedule one submitted job. */
export interface SubmitOptions {
  /** How urgently the result is needed. */
  readonly priority: JobPriority;
  /**
   * Objects in the request to transfer to the worker rather than copy; they are unusable by
   * the caller afterwards. Ignored on the main-thread fallback, where nothing is copied.
   */
  readonly transfer?: TransferList;
  /**
   * What the handler may read through its context. A worker receives each key's bytes with
   * the first job that names it; later jobs to that worker carry the key alone.
   */
  readonly resources?: readonly JobResource[];
}

/** A submitted job: its id, for cancelling or re-prioritising it, and its eventual response. */
export interface JobTicket<K extends JobKind> {
  /** The job's id. */
  readonly id: JobId;
  /**
   * Resolves with the response, whose transferred buffers now belong to the caller. Rejects
   * with a `JobCancelledError` or a `JobFailedError`; a caller that cancels must still handle
   * the rejection.
   */
  readonly response: Promise<JobResponse<K>>;
}

/** A submitted job of kind `K`: its kind and its request. */
export interface SubmittedJobOf<K extends JobKind> {
  /** The kind of job. */
  readonly kind: K;
  /** Its request. */
  readonly request: JobRequest<K>;
}

/** A job's kind and request, correlated: narrowing on `kind` narrows `request`. */
export type SubmittedJob = { [K in JobKind]: SubmittedJobOf<K> }[JobKind];

/** A pending job as a viewport classifier sees it. */
export type PendingJob = SubmittedJob & {
  /** The job's id. */
  readonly id: JobId;
  /** The job's current priority. */
  readonly priority: JobPriority;
};

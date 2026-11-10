/**
 * The message protocol between the `WorkerPool` on the engine thread and a job worker.
 * It is the contract the MSDF text port and the engine-in-a-worker task
 * build on, so it is kept small and every change to it is a change to that contract.
 *
 * The exchange, per job:
 *
 * 1. The pool posts a {@link JobRequestMessage} (`type: 'job-request'`, the job's id, its kind
 *    and its request payload) with a transfer list: the buffers whose ownership moves to the
 *    worker (they are detached on the sending side).
 * 2. The worker posts exactly one reply with the same id: a {@link JobResultMessage} with the
 *    response payload and the response's transfer list, or a {@link JobErrorMessage} with a
 *    structured {@link JobFailure}. A worker never throws across the boundary: if the result
 *    cannot be posted (not cloneable, or a bad transfer list), it posts a `handler-failed`
 *    error for the same id instead.
 * 3. If a request cannot even be deserialised in the worker, its id is unknown, so the worker
 *    posts a {@link WorkerFaultMessage}; the pool then retires that worker, failing its
 *    running jobs rather than letting one of them wait forever.
 *
 * Replies may arrive in any order; the id correlates them. Messages are plain
 * structured-cloneable objects, and both sides check what they receive with
 * {@link isJobRequestMessage} and {@link isJobReplyMessage}, since a message that crossed a
 * thread is untrusted data. The protocol is DOM-free; only the adapters in `web-worker/` touch
 * `Worker` and `postMessage`.
 */
import type { JobId } from './job-id.js';
import { isJobKind, type JobKind, type JobRequest, type JobResponse } from './job-kinds.js';
import type { JobResource } from './job-submission.js';

/**
 * Objects whose ownership moves with a message instead of being copied: in practice the
 * `ArrayBuffer`s behind typed arrays, later also `ImageBitmap`s. Typed as `object` so the
 * protocol compiles without the DOM lib; the `web-worker/` adapters hand it to `postMessage`
 * as its `Transferable[]`.
 */
export type TransferList = readonly object[];

/** A message and the transfer list to post it with. */
export interface PostedMessage<M> {
  /** The structured-cloneable message. */
  readonly message: M;
  /** Objects whose ownership moves with the message; detached on the sending side. */
  readonly transfer: TransferList;
}

/** A request for one job of kind `K`. */
export interface JobRequestMessageOf<K extends JobKind> {
  /** Discriminates the message. */
  readonly type: 'job-request';
  /** The job's id; the reply carries it back. */
  readonly id: JobId;
  /** Which handler runs the job. */
  readonly kind: K;
  /** The job's input. */
  readonly payload: JobRequest<K>;
  /** Resources the worker has not been sent before, for its cache; absent when none. */
  readonly resources?: readonly JobResource[];
}

/** A request for one job of any kind; narrowing on `kind` narrows `payload`. */
export type JobRequestMessage = { [K in JobKind]: JobRequestMessageOf<K> }[JobKind];

/** A successful reply: the job's response. */
export interface JobResultMessage {
  /** Discriminates the message. */
  readonly type: 'job-result';
  /** The id of the job this answers. */
  readonly id: JobId;
  /** The job's response; its type is the requested kind's {@link JobResponse}. */
  readonly payload: JobResponse<JobKind>;
}

/**
 * Why a job failed:
 * - `invalid-request`: the worker received a malformed request;
 * - `no-handler`: the worker has no handler registered for the kind;
 * - `handler-failed`: the handler threw, its promise rejected, or its response could not be
 *   posted (not structured-cloneable, or a transfer list naming a buffer twice or one that
 *   cannot be detached);
 * - `worker-failed`: the worker crashed, failed to load, broke the protocol or could not
 *   deserialise a request. The pool raises it; it travels only in a {@link WorkerFaultMessage}.
 */
export type JobFailureCode = 'invalid-request' | 'no-handler' | 'handler-failed' | 'worker-failed';

/** A structured, cloneable description of a failure (an `Error` does not survive cloning intact). */
export interface JobFailure {
  /** Why the job failed. */
  readonly code: JobFailureCode;
  /** The original error's `name`, for example `RangeError`. */
  readonly name: string;
  /** The original error's message. */
  readonly message: string;
}

/** A failed reply. */
export interface JobErrorMessage {
  /** Discriminates the message. */
  readonly type: 'job-error';
  /** The id of the job this answers. */
  readonly id: JobId;
  /** What went wrong. */
  readonly failure: JobFailure;
}

/** Either reply a worker sends. */
export type JobReplyMessage = JobResultMessage | JobErrorMessage;

/**
 * A failure the worker cannot attribute to one job: it received a request it could not
 * deserialise (a `messageerror`), so that request's id is lost. The pool retires the worker.
 */
export interface WorkerFaultMessage {
  /** Discriminates the message. */
  readonly type: 'worker-fault';
  /** What went wrong; its code is `worker-failed`. */
  readonly failure: JobFailure;
}

/**
 * Builds a request message. The one place where a kind and its payload, typed separately by a
 * generic caller, are joined into the correlated {@link JobRequestMessage} union.
 *
 * @param id - The job's id.
 * @param kind - The job's kind.
 * @param payload - The job's request, of that kind.
 * @param resources - Resources to send with it; the field is omitted when there are none.
 * @returns The request message.
 */
export function createJobRequestMessage<K extends JobKind>(
  id: JobId,
  kind: K,
  payload: JobRequest<K>,
  resources: readonly JobResource[] = [],
): JobRequestMessage {
  const message: JobRequestMessageOf<K> =
    resources.length === 0
      ? { type: 'job-request', id, kind, payload }
      : { type: 'job-request', id, kind, payload, resources };
  // Sound: JobRequestMessageOf<K> is the union member for K, which TypeScript cannot pick
  // for a generic K.
  return message as unknown as JobRequestMessage;
}

/**
 * Describes a thrown value as a cloneable {@link JobFailure}.
 *
 * @param code - Why the job failed.
 * @param error - What was thrown; non-`Error` values are converted to text.
 * @returns The failure.
 */
export function describeFailure(code: JobFailureCode, error: unknown): JobFailure {
  if (error instanceof Error) return { code, name: error.name, message: error.message };
  return { code, name: 'Error', message: String(error) };
}

/**
 * Tells whether a value is a readable job id: a positive integer.
 *
 * @param value - Any value.
 * @returns `true` when `value` can be a {@link JobId}.
 */
export function isJobId(value: unknown): value is JobId {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/**
 * Checks the envelope of a message received by a worker: its type, id, kind and any resources.
 * The payload is the handler's to validate.
 *
 * @param value - The received message data.
 * @returns `true` when `value` is a well-formed {@link JobRequestMessage}.
 */
export function isJobRequestMessage(value: unknown): value is JobRequestMessage {
  return (
    isRecord(value) &&
    value.type === 'job-request' &&
    isJobId(value.id) &&
    isJobKind(value.kind) &&
    'payload' in value &&
    (value.resources === undefined || isJobResourceList(value.resources))
  );
}

function isJobResourceList(value: unknown): value is readonly JobResource[] {
  return (
    Array.isArray(value) &&
    value.every(
      (resource: unknown) =>
        isRecord(resource) &&
        typeof resource.key === 'string' &&
        resource.bytes instanceof ArrayBuffer,
    )
  );
}

/** Every failure code, as a record so that a new code must be listed here to compile. */
const FAILURE_CODES: Readonly<Record<JobFailureCode, true>> = {
  'invalid-request': true,
  'no-handler': true,
  'handler-failed': true,
  'worker-failed': true,
};

function isJobFailure(value: unknown): value is JobFailure {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    Object.hasOwn(FAILURE_CODES, value.code) &&
    typeof value.name === 'string' &&
    typeof value.message === 'string'
  );
}

/**
 * Checks the envelope of a message received from a worker. The payload is trusted to match
 * the requested kind, since the worker runs this package's own handlers.
 *
 * @param value - The received message data.
 * @returns `true` when `value` is a well-formed {@link JobReplyMessage}.
 */
export function isJobReplyMessage(value: unknown): value is JobReplyMessage {
  if (!isRecord(value) || !isJobId(value.id)) return false;
  if (value.type === 'job-result') return 'payload' in value;
  return value.type === 'job-error' && isJobFailure(value.failure);
}

/**
 * Checks a message received from a worker for a {@link WorkerFaultMessage}.
 *
 * @param value - The received message data.
 * @returns `true` when `value` is a well-formed worker fault.
 */
export function isWorkerFaultMessage(value: unknown): value is WorkerFaultMessage {
  return isRecord(value) && value.type === 'worker-fault' && isJobFailure(value.failure);
}

import type { JobKind, JobRequest, JobResponse } from './job-kinds.js';
import {
  describeFailure,
  type JobReplyMessage,
  type JobRequestMessage,
  type PostedMessage,
  type TransferList,
} from './protocol.js';

/** What a running job can reach besides its request. */
export interface JobContext {
  /**
   * Reads a resource the job (or an earlier job on the same worker) was submitted with.
   *
   * @param key - The resource's key.
   * @returns Its bytes, or `undefined` when this worker has none under the key.
   */
  resource(key: string): ArrayBuffer | undefined;
}

/**
 * A context serving resources from a map.
 *
 * @param resources - The resources by key; read, never changed.
 * @returns The context.
 */
export function resourceContext(resources: ReadonlyMap<string, ArrayBuffer>): JobContext {
  return { resource: (key) => resources.get(key) };
}

/** A context with no resources, for jobs run without any. */
const NO_RESOURCES: JobContext = resourceContext(new Map());

/** What a handler produces: the response and the buffers to transfer back with it. */
export interface JobOutcome<K extends JobKind> {
  /** The job's response. */
  readonly response: JobResponse<K>;
  /**
   * Objects in `response` to transfer rather than copy, typically the buffers of its typed
   * arrays. Empty when there is nothing large to send.
   */
  readonly transfer: TransferList;
}

/**
 * Runs one kind of job. It runs in a job worker, or on the main thread when workers are
 * unavailable, so it must not assume either: no DOM, no shared state with the caller. It must
 * not mutate its request (on the main-thread fallback the request is the caller's own
 * object). A handler that keeps per-worker state (for example a loaded font) must tolerate
 * several of its jobs being in flight at once, since the pool sends up to its in-flight cap.
 * The pool always passes a context; it is optional here so a handler can be called directly
 * with its request alone, as tests do.
 */
export type JobHandler<K extends JobKind> = (
  request: JobRequest<K>,
  context?: JobContext,
) => JobOutcome<K> | Promise<JobOutcome<K>>;

/** A handler as registered: the pool and the worker entry always give it a context. */
export type RegisteredJobHandler<K extends JobKind> = (
  request: JobRequest<K>,
  context: JobContext,
) => JobOutcome<K> | Promise<JobOutcome<K>>;

/** The handlers a job worker (or the main-thread fallback) has registered, by kind. */
export type JobHandlers = { readonly [K in JobKind]?: RegisteredJobHandler<K> };

function handlerFor<K extends JobKind>(
  handlers: JobHandlers,
  kind: K,
): RegisteredJobHandler<K> | undefined {
  return handlers[kind];
}

/**
 * Runs a request through the handler registered for its kind and builds the reply. Never
 * rejects: a missing handler or a handler that throws becomes a `job-error` reply. The handler
 * is called synchronously, before the first `await`, so when the main-thread fallback runs a
 * job inside a `WorkQueue` drain, the handler's synchronous work counts against the budget.
 *
 * @param handlers - The registered handlers.
 * @param request - The job to run.
 * @param context - What its handler can reach: the worker's (or the submit's) resources.
 * @returns The reply to post and its transfer list.
 */
export async function runJob(
  handlers: JobHandlers,
  request: JobRequestMessage,
  context: JobContext = NO_RESOURCES,
): Promise<PostedMessage<JobReplyMessage>> {
  const { id, kind } = request;
  const handler = handlerFor(handlers, kind);
  if (handler === undefined) {
    const error = new Error(`No handler is registered for "${kind}" jobs.`);
    return {
      message: { type: 'job-error', id, failure: describeFailure('no-handler', error) },
      transfer: [],
    };
  }
  try {
    const { response, transfer } = await handler(request.payload, context);
    return { message: { type: 'job-result', id, payload: response }, transfer };
  } catch (error) {
    return {
      message: { type: 'job-error', id, failure: describeFailure('handler-failed', error) },
      transfer: [],
    };
  }
}

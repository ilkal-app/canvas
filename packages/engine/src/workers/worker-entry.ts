import { resourceContext, runJob, type JobHandlers } from './job-handlers.js';
import {
  describeFailure,
  isJobId,
  isJobRequestMessage,
  type JobErrorMessage,
  type JobReplyMessage,
  type PostedMessage,
  type TransferList,
  type WorkerFaultMessage,
} from './protocol.js';

/**
 * Posts one message from a job worker with its transfer list. It throws as `postMessage` does,
 * for example a `DataCloneError` when the message cannot be cloned or a buffer in the transfer
 * list is listed twice or cannot be detached.
 *
 * @param message - The structured-cloneable message.
 * @param transfer - Objects to transfer rather than copy.
 */
export type ReplyPoster = (message: unknown, transfer: TransferList) => void;

/**
 * The worker side of the job protocol, DOM-free. `serveWorkerEntry` binds it to a real
 * worker's `self`, passing a {@link ReplyPoster} that calls `self.postMessage`.
 */
export interface WorkerEntry {
  /**
   * Handles one received message and posts its reply, if it has one. Never rejects, unless
   * even a failure reply cannot be posted, which means the channel itself is gone.
   *
   * @param data - The message data.
   * @param post - Posts the reply.
   * @returns Settles once the reply has been posted.
   */
  onMessage(data: unknown, post: ReplyPoster): Promise<void>;
  /**
   * Handles a `messageerror`: a request arrived that could not be deserialised, so its id is
   * unknown. Posts a `worker-fault`, and the pool retires this worker.
   *
   * @param post - Posts the fault.
   */
  onMessageError(post: ReplyPoster): void;
}

/**
 * Builds the reply to one received message: well-formed requests run through the handlers; a
 * malformed message with a readable id is answered `invalid-request`, so the pool never waits
 * on it; one without an id gets no reply.
 *
 * @param handlers - The registered handlers.
 * @param data - The message data.
 * @param resources - This worker's resources by key: a request's are added before it runs.
 * @returns The reply and its transfer list, or `undefined` for no reply.
 */
async function replyTo(
  handlers: JobHandlers,
  data: unknown,
  resources: Map<string, ArrayBuffer>,
): Promise<PostedMessage<JobReplyMessage> | undefined> {
  if (isJobRequestMessage(data)) {
    for (const { key, bytes } of data.resources ?? []) resources.set(key, bytes);
    return runJob(handlers, data, resourceContext(resources));
  }
  const id: unknown =
    typeof data === 'object' && data !== null && 'id' in data ? data.id : undefined;
  if (!isJobId(id)) return undefined;
  const error = new TypeError('The worker received a malformed job request.');
  return {
    message: { type: 'job-error', id, failure: describeFailure('invalid-request', error) },
    transfer: [],
  };
}

/**
 * Creates the worker side of the job protocol (see `protocol.ts`). Each request gets exactly
 * one reply: if its result cannot be posted (a `DataCloneError`), a `handler-failed` error for
 * the same id is posted instead, so the pool's job settles and its worker slot is freed. A
 * job worker's whole script is `serveWorkerEntry(self, createWorkerEntry(handlers))`, an app's
 * with `createProductionJobHandlers()`. The handlers are required, so a bundle carries only the
 * ones its script names.
 *
 * @param handlers - The handlers to register.
 * @returns The entry.
 */
export function createWorkerEntry(handlers: JobHandlers): WorkerEntry {
  // The resources the pool has sent this worker, kept for its life: the pool sends each once.
  const resources = new Map<string, ArrayBuffer>();
  return {
    async onMessage(data, post) {
      const reply = await replyTo(handlers, data, resources);
      if (reply === undefined) return;
      try {
        post(reply.message, reply.transfer);
      } catch (error) {
        const failed: JobErrorMessage = {
          type: 'job-error',
          id: reply.message.id,
          failure: describeFailure('handler-failed', error),
        };
        post(failed, []);
      }
    },
    onMessageError(post) {
      const error = new Error('The job worker received a request it could not deserialise.');
      const fault: WorkerFaultMessage = {
        type: 'worker-fault',
        failure: describeFailure('worker-failed', error),
      };
      post(fault, []);
    },
  };
}

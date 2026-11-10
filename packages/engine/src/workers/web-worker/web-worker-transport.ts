/**
 * The Web Worker adapters of the job protocol (`../protocol.ts`): the only engine code outside
 * `gpu/` that touches `Worker`, `postMessage` and `Transferable`. Its own TypeScript project
 * with the WebWorker lib, so the rest of the engine stays DOM-free.
 *
 * This project cannot import the engine core (the core references it, and references do not
 * cycle), so the types below restate the core's `WorkerTransport`, `WorkerEntry` and
 * `ReplyPoster` shapes with `unknown` messages; `worker-transport.test.ts` in the core checks
 * they stay assignable.
 */

/** Receives what a job worker sends back, and news of its failure. */
export interface WebWorkerTransportListener {
  /**
   * Called with the data of each message the worker posts.
   *
   * @param data - The message data, unchecked.
   */
  onMessage(data: unknown): void;
  /**
   * Called when the worker fails as a whole.
   *
   * @param error - What went wrong.
   */
  onFailure(error: Error): void;
}

/** A `Worker` seen through the core's `WorkerTransport` interface. */
export interface WebWorkerTransport {
  /**
   * Starts delivering the worker's messages and failures.
   *
   * @param listener - Where to deliver them.
   */
  connect(listener: WebWorkerTransportListener): void;
  /**
   * Posts a message; the objects in `transfer` move to the worker.
   *
   * @param message - The structured-cloneable message.
   * @param transfer - Objects to transfer rather than copy.
   */
  post(message: unknown, transfer: readonly object[]): void;
  /** Terminates the worker; nothing more is delivered. */
  terminate(): void;
}

/**
 * Posts one message from a job worker; throws as `postMessage` does.
 *
 * @param message - The structured-cloneable message.
 * @param transfer - Objects to transfer rather than copy.
 */
export type WebWorkerPoster = (message: unknown, transfer: readonly object[]) => void;

/** The worker side of the protocol, as `createWorkerEntry` in the core builds it. */
export interface WebWorkerEntry {
  /**
   * Handles one received message, posting its reply through `post`.
   *
   * @param data - The message data.
   * @param post - Posts on the worker's `self`.
   * @returns Settles once the reply has been posted.
   */
  onMessage(data: unknown, post: WebWorkerPoster): Promise<void>;
  /**
   * Handles a request that could not be deserialised.
   *
   * @param post - Posts on the worker's `self`.
   */
  onMessageError(post: WebWorkerPoster): void;
}

/**
 * `postMessage` wants `Transferable[]`; the protocol keeps transfer lists as `object[]` so it
 * compiles without a browser lib. Every entry is a transferable the handlers put there.
 *
 * @param transfer - The protocol's transfer list.
 * @returns The same objects, typed for `postMessage`.
 */
function toTransferables(transfer: readonly object[]): Transferable[] {
  return [...transfer] as Transferable[];
}

/** The fields of a worker's `error` event this adapter reads; each may be missing. */
interface WorkerErrorDetails {
  readonly message?: string;
  readonly filename?: string;
  readonly lineno?: number;
  readonly error?: unknown;
}

/**
 * A thrown value as text: an `Error` as `Name: message`, a string as itself, anything else (a
 * worker may throw any value) as its type and its JSON.
 *
 * @param cause - The value the worker threw, or the event's message.
 * @returns The text.
 */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.toString();
  if (typeof cause === 'string') return cause;
  try {
    // JSON.stringify returns undefined for a function or a symbol, whatever its type says.
    const json = JSON.stringify(cause) as string | undefined;
    return json === undefined ? typeof cause : `${typeof cause} ${json}`;
  } catch {
    return typeof cause;
  }
}

/**
 * Whether a worker's `error` event is its script failing to load: a plain `Event`, with no
 * message, script or error (an uncaught error in the worker is an `ErrorEvent` that has them).
 *
 * @param event - The `error` event.
 * @returns True for a load failure.
 */
function isLoadFailure(event: Event): boolean {
  const { message, filename, error } = event as WorkerErrorDetails;
  return error === undefined && (message ?? '') === '' && (filename ?? '') === '';
}

/**
 * How long a worker whose script could not be loaded waits before its failure is reported, ms:
 * Safari fails a worker whose script is still loading as soon as the page starts to leave, before
 * `pagehide`, so the failure waits for the page to go first.
 */
const LOAD_FAILURE_GRACE_MS = 1000;

/** What a transport hears the page leave by: the page's `window` (a worker's scope never does). */
export interface PageLeaveScope {
  /**
   * Starts listening for the page leaving.
   *
   * @param type - `pagehide`.
   * @param listener - Called when the page leaves.
   */
  addEventListener(type: 'pagehide', listener: () => void): void;
  /**
   * Stops listening for the page leaving.
   *
   * @param type - `pagehide`.
   * @param listener - The listener given to `addEventListener`.
   */
  removeEventListener(type: 'pagehide', listener: () => void): void;
}

/**
 * The failure message of a job worker's `error` event. An uncaught error in the worker is an
 * `ErrorEvent` with the script, the line and the error; a module worker whose script fails to
 * load fires a plain `Event` with none of them, so the message says so instead of `undefined`.
 *
 * @param event - The `error` event, an `ErrorEvent` or a plain `Event`.
 * @returns What went wrong, naming the script and line when the event has them.
 */
function describeWorkerError(event: Event): string {
  const { message, filename, lineno, error } = event as WorkerErrorDetails;
  const cause = error ?? (message === '' ? undefined : message);
  const detail =
    cause === undefined ? 'the worker script could not be loaded.' : describeCause(cause);
  if (filename === undefined || filename === '') return `The job worker failed: ${detail}`;
  const line = lineno === undefined || lineno === 0 ? '' : `:${String(lineno)}`;
  return `The job worker failed at ${filename}${line}: ${detail}`;
}

/**
 * Adapts a started job worker to the pool's transport interface. The app starts the worker
 * (it owns the bundler, so it owns the worker's URL) and hands it over:
 * `createWebWorkerTransport(new Worker(url, { type: 'module' }))`. An `error` event (the
 * script failed to load, or an uncaught error) and a `messageerror` event (a reply could not
 * be deserialised) are both reported as failures of the worker, so no job waits forever. A
 * script that failed to load is reported a second later, and not at all if the page has left
 * by then: Safari fails a loading worker as a page starts to leave, and a page that
 * leaves runs no timers, or runs them only when it comes back from the back-forward cache.
 *
 * @param worker - The job worker, whose script calls {@link serveWorkerEntry}.
 * @param scope - Where the page's `pagehide` fires: the global scope by default.
 * @returns The transport; the pool connects it.
 */
export function createWebWorkerTransport(
  worker: Worker,
  scope: PageLeaveScope = globalThis,
): WebWorkerTransport {
  let isTerminated = false;
  let hasPageLeft = false;
  let pendingFailure: ReturnType<typeof setTimeout> | undefined;
  const onPageLeave = (): void => {
    hasPageLeft = true;
  };
  // Touches the scope only while a failure waits: a pool in Node, or one never failed, has no
  // pagehide listener to remove (Node's global scope has no event listeners at all).
  const stopWaiting = (): void => {
    if (pendingFailure === undefined) return;
    clearTimeout(pendingFailure);
    pendingFailure = undefined;
    scope.removeEventListener('pagehide', onPageLeave);
  };
  return {
    connect(listener) {
      worker.addEventListener('message', (event) => {
        if (!isTerminated) listener.onMessage(event.data);
      });
      worker.addEventListener('error', (event) => {
        if (isTerminated) return;
        const error = new Error(describeWorkerError(event));
        if (!isLoadFailure(event)) {
          listener.onFailure(error);
          return;
        }
        if (pendingFailure !== undefined) return;
        scope.addEventListener('pagehide', onPageLeave);
        pendingFailure = setTimeout(() => {
          stopWaiting();
          if (!hasPageLeft) listener.onFailure(error);
        }, LOAD_FAILURE_GRACE_MS);
      });
      worker.addEventListener('messageerror', () => {
        if (!isTerminated) {
          listener.onFailure(new Error('A message from the job worker could not be deserialised.'));
        }
      });
    },
    post(message, transfer) {
      worker.postMessage(message, toTransferables(transfer));
    },
    terminate() {
      isTerminated = true;
      stopWaiting();
      worker.terminate();
    },
  };
}

/**
 * Serves the job protocol from inside a job worker: hands each received message, and each
 * `messageerror`, to `entry` with a poster bound to `scope`. The entry, not this adapter,
 * decides what to post when posting fails, so the protocol stays in the core. A job worker's
 * whole script is `serveWorkerEntry(self, createWorkerEntry(handlers))`, all imported from
 * `@canvas/engine`.
 *
 * @param scope - The worker's global scope, `self`.
 * @param entry - The worker side of the protocol, from `createWorkerEntry`.
 */
export function serveWorkerEntry(scope: DedicatedWorkerGlobalScope, entry: WebWorkerEntry): void {
  const post: WebWorkerPoster = (message, transfer) => {
    scope.postMessage(message, toTransferables(transfer));
  };
  scope.addEventListener('message', (event) => {
    void entry.onMessage(event.data, post);
  });
  scope.addEventListener('messageerror', () => {
    entry.onMessageError(post);
  });
}

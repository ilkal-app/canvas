import { AssetsHttpError } from './assets-responses.js';
import type { PutFile } from './run-upload.js';

/** The part of an `XMLHttpRequest` a put uses. */
export interface PutRequest {
  /** The upload's progress events. */
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null };
  /** Called when the request finished (any status). */
  onload: ((event: ProgressEvent) => void) | null;
  /** Called when the request got no answer. */
  onerror: ((event: ProgressEvent) => void) | null;
  /** Called when the request was aborted. */
  onabort: ((event: ProgressEvent) => void) | null;
  /** The answer's status. */
  readonly status: number;
  /** How the answer's body is read: `text`, so Firefox never parses an empty one as XML. */
  responseType: XMLHttpRequestResponseType;
  /**
   * Opens the request.
   *
   * @param method - The method.
   * @param url - The URL.
   */
  open(method: string, url: string): void;
  /**
   * Sets a header.
   *
   * @param name - Its name.
   * @param value - Its value.
   */
  setRequestHeader(name: string, value: string): void;
  /**
   * Sends the body.
   *
   * @param body - The body.
   */
  send(body: Blob): void;
  /** Aborts the request. */
  abort(): void;
}

/**
 * How long a put may go without progress before it is abandoned, ms: a stalled upload ends as a
 * failure with Retry rather than hanging.
 */
export const PUT_STALL_TIMEOUT_MS = 60_000;

/**
 * The browser's put with upload progress (`fetch` reports none): an `XMLHttpRequest` to the
 * signed URL with the declared headers, progress from its `upload` events. An answer that is not
 * 2xx rejects with an `AssetsHttpError` of its status (`403 put-expired` for a signed URL the
 * store refused, which expires during a slow upload; `410` for a closed upload), no answer with
 * status 0, a put without progress for `stallMs` with `0 stalled` (it is aborted), and an
 * aborted `signal` with `0 aborted`. The URL is never logged. Page.
 *
 * @param createRequest - Makes the request; `new XMLHttpRequest()` by default.
 * @param stallMs - How long a put may go without progress, ms; {@link PUT_STALL_TIMEOUT_MS}.
 * @returns The put.
 */
export function createXhrPut(
  createRequest: () => PutRequest = () => new XMLHttpRequest(),
  stallMs = PUT_STALL_TIMEOUT_MS,
): PutFile {
  return (url, headers, body, onProgress, signal) =>
    new Promise((resolve, reject) => {
      const request = createRequest();
      let failure: AssetsHttpError | undefined;
      let stall: ReturnType<typeof setTimeout> | undefined;
      const stop = (error: AssetsHttpError) => {
        failure = error;
        request.abort();
      };
      const watch = () => {
        clearTimeout(stall);
        stall = setTimeout(() => {
          stop(new AssetsHttpError(0, 'stalled', 'The upload stalled.'));
        }, stallMs);
      };
      const onAbort = () => {
        stop(new AssetsHttpError(0, 'aborted', 'The upload was stopped.'));
      };
      const settle = (error?: AssetsHttpError) => {
        clearTimeout(stall);
        signal?.removeEventListener('abort', onAbort);
        if (error === undefined) resolve();
        else reject(error);
      };
      request.open('PUT', url);
      // The store answers a put with an empty body; Firefox parses one of the default type as
      // XML and logs "XML Parsing Error: no root element found".
      request.responseType = 'text';
      for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
      request.upload.onprogress = (event) => {
        watch();
        onProgress(event.loaded, event.lengthComputable ? event.total : body.size);
      };
      request.onload = () => {
        const { status } = request;
        if (status >= 200 && status < 300) settle();
        else {
          const code = status === 403 ? 'put-expired' : 'put-refused';
          settle(new AssetsHttpError(status, code, 'The store refused the upload.'));
        }
      };
      request.onerror = () => {
        settle(new AssetsHttpError(0, 'network', 'The upload could not reach the store.'));
      };
      request.onabort = () => {
        settle(failure ?? new AssetsHttpError(0, 'aborted', 'The upload was stopped.'));
      };
      if (signal?.aborted === true) {
        settle(new AssetsHttpError(0, 'aborted', 'The upload was stopped.'));
        return;
      }
      signal?.addEventListener('abort', onAbort);
      watch();
      request.send(body);
    });
}

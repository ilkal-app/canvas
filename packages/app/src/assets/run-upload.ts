import type { AssetsHttp } from './assets-http.js';
import { AssetsHttpError } from './assets-responses.js';
import { megabytes } from './image-files.js';
import type { PreparedImage } from './prepare-image.js';
import type { UploadEvent } from './upload-state.js';

/**
 * Puts a file to a signed URL, reporting bytes sent (`XMLHttpRequest`'s upload progress in the
 * browser: `fetch` reports none).
 *
 * @param url - The signed URL.
 * @param headers - The headers the declaration named.
 * @param body - The file.
 * @param onProgress - Called with bytes sent and bytes in all.
 * @returns Settles once the store accepted the bytes; rejects otherwise.
 */
export type PutFile = (
  url: string,
  headers: Readonly<Record<string, string>>,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
) => Promise<void>;

/** What an upload runs with. */
export interface UploadRunOptions {
  /** The board's client now (a refreshed token makes a new one). */
  readonly http: () => AssetsHttp;
  /** Puts the bytes. */
  readonly put: PutFile;
  /** Waits, ms (a `Retry-After`). */
  readonly wait: (delayMs: number) => Promise<void>;
  /** Gets a fresh token after the service refused one. */
  readonly refreshAccess: () => Promise<void>;
  /** Receives what happened, for the upload's state (`stepUpload`). */
  readonly onEvent: (event: UploadEvent) => void;
  /** Stops the upload (the page's images destroyed): its put is aborted. */
  readonly signal?: AbortSignal;
}

/** How many times a step refused as busy or rate-limited is tried again before giving up. */
export const MAX_BUSY_RETRIES = 3;

/** The longest `Retry-After` an upload waits for on its own, ms; longer ones fail visibly. */
export const MAX_RETRY_WAIT_MS = 30_000;

/** Completion refusals that a fresh declaration and put can fix (the stage replaced, collected). */
const REDECLARE_CODES: ReadonlySet<string> = new Set([
  // The store refused the signed PUT (`403`): its URL expired during a slow upload.
  'put-expired',
  'upload-changed',
  'hash-mismatch',
  'not-uploaded',
  'unknown-upload',
  'asset-collected',
]);

/**
 * The sentence for an upload that failed, for the image's badge.
 *
 * @param error - What it failed with.
 * @returns The sentence.
 */
export function uploadFailureMessage(error: unknown): string {
  if (!(error instanceof AssetsHttpError)) return 'The upload failed.';
  if (error.code === 'stalled') return 'The upload stalled.';
  if (error.code === 'put-expired') return 'The upload took too long.';
  if (error.status === 0) return 'The upload could not reach the server.';
  if (error.status === 401 || error.status === 403) {
    return 'This board does not let you upload images.';
  }
  if (error.status === 413 && error.code === 'too-large' && error.limit !== undefined)
    return `This board's plan takes images up to ${megabytes(error.limit)} MB.`;
  if (error.status === 413 && error.code === 'storage-limit' && error.limit !== undefined)
    return `This board's owner has used their plan's ${megabytes(error.limit)} MB of image storage.`;
  if (error.status === 413) return 'The image is larger than the server takes.';
  if (error.status === 415 || error.code === 'unsupported-image') {
    return 'The server does not take this kind of image.';
  }
  if (error.status === 429 || error.status === 503) return 'The server is busy. Try again later.';
  return 'The upload failed.';
}

/**
 * Runs one step, trying it again after the service's `Retry-After` while it answers busy or
 * rate-limited ({@link MAX_BUSY_RETRIES} times, waits up to {@link MAX_RETRY_WAIT_MS}), and once
 * with a fresh token after a `401`.
 *
 * @param step - The step.
 * @param options - The wait and the token refresh.
 * @returns The step's result.
 */
export async function withRetries<T>(
  step: () => Promise<T>,
  options: Pick<UploadRunOptions, 'wait' | 'refreshAccess'>,
): Promise<T> {
  let busy = 0;
  let isRefreshed = false;
  for (;;) {
    try {
      return await step();
    } catch (error) {
      if (!(error instanceof AssetsHttpError)) throw error;
      const waitMs = error.retryAfterMs ?? 1000;
      const isBusy = error.status === 429 || error.status === 503;
      if (isBusy && busy < MAX_BUSY_RETRIES && waitMs <= MAX_RETRY_WAIT_MS) {
        busy += 1;
        await options.wait(waitMs);
      } else if (error.status === 401 && !isRefreshed) {
        isRefreshed = true;
        await options.refreshAccess();
      } else throw error;
    }
  }
}

/**
 * Declares, puts and completes once: the assets service's staged, single-use upload.
 *
 * @param image - The prepared image.
 * @param file - Its bytes.
 * @param options - The client, the put and the callbacks.
 * @returns Settles once the service has the bytes and the board is linked.
 */
async function uploadOnce(
  image: PreparedImage,
  file: Blob,
  options: UploadRunOptions,
): Promise<void> {
  const declared = await withRetries(() => options.http().declare(image), options);
  if (declared.status === 'linked') {
    options.onEvent({ type: 'sent-all' });
    options.onEvent({
      type: 'record',
      status: declared.asset.status,
      progress: declared.asset.progress,
    });
    return;
  }
  await options.put(
    declared.url,
    declared.headers,
    file,
    (loaded, total) => {
      options.onEvent({ type: 'sent', loaded, total });
    },
    options.signal,
  );
  options.onEvent({ type: 'sent-all' });
  const record = await withRetries(
    () => options.http().complete(image.assetId, declared.uploadId),
    options,
  );
  options.onEvent({ type: 'record', status: record.status, progress: record.progress });
}

/**
 * Uploads an image (the assets service's staged uploads): declares it, puts its bytes
 * to the upload's signed URL with progress, and completes it, which links the board once the
 * service has verified the bytes against the hash; a board already linked skips the put. Busy and
 * rate-limit refusals wait out their `Retry-After`; a completion that a fresh upload can fix
 * (the stage changed, the asset collected meanwhile), or a put whose signed URL expired during a
 * slow upload (`403`), starts over once. A failure is reported as
 * an `error` event with a sentence for the person, never thrown. The token is only ever in the
 * client's headers. Page.
 *
 * @param image - The prepared image.
 * @param file - Its bytes.
 * @param options - The client, the put, the wait, the token refresh and the event callback.
 * @returns Settles when the upload is done or has failed.
 */
export async function runUpload(
  image: PreparedImage,
  file: Blob,
  options: UploadRunOptions,
): Promise<void> {
  options.onEvent({ type: 'start' });
  try {
    try {
      await uploadOnce(image, file, options);
    } catch (error) {
      if (!(error instanceof AssetsHttpError) || !REDECLARE_CODES.has(error.code)) throw error;
      await uploadOnce(image, file, options);
    }
  } catch (error) {
    if (options.signal?.aborted === true) return;
    options.onEvent({ type: 'error', message: uploadFailureMessage(error) });
  }
}

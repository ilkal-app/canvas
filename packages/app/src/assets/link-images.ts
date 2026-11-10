import type { AssetRecord } from '@canvas/schema';

import type { AssetsHttp } from './assets-http.js';
import { AssetsHttpError } from './assets-responses.js';

// The image panel's From link: what a refused link says to the person and how long a
// linked image's size is waited for.

/** What each refused link says. */
const LINK_MESSAGES: Readonly<Record<string, string>> = {
  'invalid-url': 'That doesn’t look like a web link.',
  'unsupported-scheme': 'Only http and https links can be added.',
  credentials: 'Links with a user name or password can’t be added.',
  port: 'Links on unusual ports can’t be added.',
  'private-address': 'That link points inside a private network.',
  unresolvable: 'That link’s site could not be found.',
  'http-status': 'That link didn’t answer with an image.',
  'not-an-image': 'That link isn’t a PNG, JPEG, GIF, WebP or AVIF image.',
  'too-large': 'That image is larger than 25 MB.',
  unreachable: 'That link could not be reached.',
  'too-many-redirects': 'That link redirects too many times.',
  timeout: 'That link took too long to answer.',
  'rate-limited': 'Too many images at once. Try again in a moment.',
  busy: 'Too many images at once. Try again in a moment.',
  forbidden: 'You can’t add images to this board.',
};

/**
 * What a refused link says to the person. Pure.
 *
 * @param error - What the request threw.
 * @returns A sentence.
 */
export function linkProblemMessage(error: unknown): string {
  if (error instanceof AssetsHttpError) {
    return LINK_MESSAGES[error.code] ?? 'That image could not be added.';
  }
  return 'That image could not be added.';
}

/** How long a linked image's size is waited for, ms. */
export const LINK_SIZE_WAIT_MS = 30_000;

/** A pixel size. */
export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

/**
 * A linked image's size: the record's, or, while the service has not read it yet, the first one
 * its events give; undefined when it fails or the wait ends.
 *
 * @param http - The assets client.
 * @param record - The record the link gave.
 * @param timeoutMs - How long to wait.
 * @returns The size, or undefined.
 */
export async function linkedImageSize(
  http: Pick<AssetsHttp, 'events'>,
  record: AssetRecord,
  timeoutMs = LINK_SIZE_WAIT_MS,
): Promise<PixelSize | undefined> {
  if (record.naturalSize !== null) return record.naturalSize;
  const stop = new AbortController();
  const timer = setTimeout(() => {
    stop.abort();
  }, timeoutMs);
  let size: PixelSize | undefined;
  try {
    await http.events(
      record.id,
      (next) => {
        if (next.naturalSize !== null) {
          size = next.naturalSize;
          stop.abort();
        } else if (next.status === 'failed') {
          stop.abort();
        }
      },
      stop.signal,
    );
  } catch {
    // Aborted once the size came, the asset failed or the wait ended.
  } finally {
    clearTimeout(timer);
  }
  return size;
}

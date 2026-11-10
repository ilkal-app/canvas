import { ImageLoadDeferredError } from '@canvas/engine';

import { AssetsHttpError } from './assets-responses.js';

/**
 * Maps read capacity waits to engine deferrals rather than ordinary image failures.
 *
 * @param result - Image bytes or a read refusal.
 * @returns The original bytes when available.
 * @throws {ImageLoadDeferredError} For 429, with a timer-sized chunk of the remaining wait.
 * @throws {Error} For other fetch failures.
 */
export async function withImageCapacity(result: Promise<ArrayBuffer>): Promise<ArrayBuffer> {
  try {
    return await result;
  } catch (error) {
    if (error instanceof AssetsHttpError && error.status === 429) {
      const delay = Number.isFinite(error.retryAfterMs) ? (error.retryAfterMs ?? 1000) : 1000;
      throw new ImageLoadDeferredError(Math.min(2_147_483_647, Math.max(1000, delay)));
    }
    throw error;
  }
}

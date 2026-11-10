import type { GpuBackend } from '../gpu/gpu-backend.js';

import { cropPixels, type EnginePixels, type PixelRect, type PixelSize } from './engine-pixels.js';

/** A pixel read waiting for the next frame. */
export interface PendingRead {
  /** The rectangle to read, device px. */
  readonly rect: PixelRect;
  /** Answers the read. */
  readonly resolve: (pixels: EnginePixels) => void;
  /** Fails the read. */
  readonly reject: (error: Error) => void;
}

/**
 * A thrown value as an `Error`.
 *
 * @param value - What was thrown.
 * @returns It, or an `Error` whose message is its string form.
 */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Starts one read-back of the frame just drawn, in this task (a GPU canvas can be read only
 * before it is presented), and answers every waiting read from it.
 *
 * @param backend - The backend that drew the frame.
 * @param size - The drawing buffer's size, device px.
 * @param reads - The reads this frame answers.
 * @param hasDrawn - Whether the frame drew anything; without a camera it did not.
 */
export function answerFrameReads(
  backend: GpuBackend,
  size: PixelSize,
  reads: readonly PendingRead[],
  hasDrawn: boolean,
): void {
  if (reads.length === 0) return;
  if (!hasDrawn) {
    const error = new Error('No camera is set, so the engine drew nothing to read.');
    for (const read of reads) read.reject(error);
    return;
  }
  backend.readPixels().then(
    (pixels) => {
      for (const read of reads) {
        try {
          read.resolve(cropPixels(pixels, size, read.rect));
        } catch (error) {
          read.reject(toError(error));
        }
      }
    },
    (error: unknown) => {
      for (const read of reads) read.reject(toError(error));
    },
  );
}

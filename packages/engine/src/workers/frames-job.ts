import { isGif, parseGif } from '../images/gif-file.js';
import { decodeGifFrames } from '../images/gif-frames.js';

import type { JobHandler } from './job-handlers.js';

/**
 * The `frames` job's handler: decodes an animated GIF's frames
 * for playback in the job worker, never on the thread that renders, with the engine's own GIF
 * decoder (`decodeGifFrames`: pure, so every browser composes, times and scales frames the same
 * way, and golden scenes are deterministic), scaled down to the request's limits and
 * premultiplied. A GIF of one frame, or a file that is not a GIF, comes back with no frames:
 * nothing to play, and its image keeps its still level. The frames' buffers are transferred back.
 *
 * @param request - The original and the limits.
 * @returns The frames.
 * @throws {RangeError} When the GIF is malformed or too large to animate (`decodeGifFrames`).
 */
export const framesJob: JobHandler<'frames'> = (request) => {
  const bytes = new Uint8Array(request.bytes);
  const still = { assetId: request.assetId, widthPx: 0, heightPx: 0, frames: [], plays: 1 };
  if (!isGif(bytes) || parseGif(bytes).frames.length < 2) return { response: still, transfer: [] };
  const decoded = decodeGifFrames(bytes, request);
  return {
    response: { assetId: request.assetId, ...decoded },
    transfer: decoded.frames.map(({ rgba }) => rgba.buffer),
  };
};

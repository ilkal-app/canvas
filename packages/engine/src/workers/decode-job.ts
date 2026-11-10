import { isFixtureImage, readFixtureImage, renderFixtureImage } from '../images/fixture-image.js';
import { isGif, parseGif } from '../images/gif-file.js';
import { composeGifFrames, downscalePremultiplied } from '../images/gif-frames.js';
import { levelSize, type Size } from '../images/level-selection.js';

import type { JobHandler } from './job-handlers.js';
import type { DecodedLevel } from './job-kinds.js';

/**
 * A decoded image a {@link ImageBitmapFactory} made: in a job worker, an `ImageBitmap`. Held
 * only for the length of one job.
 */
export interface DecodedImage {
  /** The decoded width, px. */
  readonly widthPx: number;
  /** The decoded height, px. */
  readonly heightPx: number;
  /**
   * Resizes the image and reads its pixels.
   *
   * @param widthPx - The output width, px.
   * @param heightPx - The output height, px.
   * @returns RGBA, 8 bits per channel, straight alpha, rows top to bottom.
   */
  readPixels(widthPx: number, heightPx: number): Promise<Uint8Array<ArrayBuffer>>;
  /** Frees the decoded image. */
  close(): void;
}

/**
 * Decodes encoded image files (AVIF, WebP, PNG, JPEG): `createImageBitmap` in a job worker
 * (`createBrowserBitmapFactory`, `workers/web-worker/`). The engine core has no DOM, so the job
 * worker's script supplies it.
 */
export interface ImageBitmapFactory {
  /**
   * Decodes one file.
   *
   * @param bytes - The encoded file.
   * @param mimeType - Its media type, or an empty string to let the decoder sniff it.
   * @returns The decoded image.
   */
  decode(bytes: ArrayBuffer, mimeType: string): Promise<DecodedImage>;
}

/** Options for {@link createDecodeJobHandler}. */
export interface DecodeJobOptions {
  /** Decodes encoded files. Without it only fixture images and GIFs decode. */
  readonly bitmaps?: ImageBitmapFactory;
}

/**
 * The size of one requested level: the long edge asked for, or the decoded size when that is
 * smaller (a level is never enlarged).
 *
 * @param source - The decoded size, px.
 * @param longEdgePx - The requested long edge, px.
 * @returns The level's size, px.
 */
function outputSize(source: Size, longEdgePx: number): Size {
  return longEdgePx >= Math.max(source.width, source.height)
    ? source
    : levelSize(source, longEdgePx);
}

/**
 * Premultiplies straight-alpha RGBA pixels by their alpha, in place:
 * levels are stored premultiplied, so the GPU's linear filtering never blends a transparent
 * pixel's colour into its neighbours (dark fringes on transparent edges). Opaque pixels are
 * unchanged.
 *
 * @param rgba - RGBA, 8 bits per channel, straight alpha; premultiplied on return.
 * @returns The same array.
 */
export function premultiplyAlpha<T extends Uint8Array>(rgba: T): T {
  const bytes = new DataView(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let offset = 0; offset + 3 < rgba.byteLength; offset += 4) {
    const alpha = bytes.getUint8(offset + 3);
    if (alpha === 255) continue;
    for (let channel = offset; channel < offset + 3; channel += 1) {
      bytes.setUint8(channel, Math.round((bytes.getUint8(channel) * alpha) / 255));
    }
  }
  return rgba;
}

/**
 * A GIF's first frame at each requested long edge, with the engine's own GIF decoder: how the
 * `decode` job reads a GIF where it has no bitmap factory (golden scenes, tests), as browsers
 * show a GIF's first frame.
 *
 * @param bytes - The GIF.
 * @param longEdgesPx - The levels' long edges, px.
 * @returns The levels, premultiplied.
 */
function gifStillLevels(bytes: ArrayBuffer, longEdgesPx: readonly number[]): DecodedLevel[] {
  const file = parseGif(new Uint8Array(bytes));
  const source = { width: file.widthPx, height: file.heightPx };
  const levels: DecodedLevel[] = [];
  composeGifFrames({ ...file, frames: file.frames.slice(0, 1) }, (canvas) => {
    for (const longEdgePx of longEdgesPx) {
      const size = outputSize(source, longEdgePx);
      levels.push({
        widthPx: size.width,
        heightPx: size.height,
        rgba: downscalePremultiplied(canvas, source, size),
      });
    }
  });
  return levels;
}

/**
 * Creates the `decode` job's handler (client-side resizing as the immediate path): it decodes the
 * file once and resizes it to each requested long edge, in the job worker, never on the thread that
 * renders; the pixels are premultiplied by their alpha there (`premultiplyAlpha`) and transferred
 * back. A server level is decoded the same way with its own long edge. Fixture images
 * (`encodeFixtureImage`) are rendered at each size directly, and without a bitmap factory a GIF's
 * first frame is decoded by the engine's own GIF decoder.
 *
 * @param options - The bitmap factory for encoded files.
 * @returns The handler.
 */
export function createDecodeJobHandler(options: DecodeJobOptions = {}): JobHandler<'decode'> {
  return async (request) => {
    const levels: DecodedLevel[] = [];
    if (isFixtureImage(request.bytes)) {
      const header = readFixtureImage(request.bytes);
      const source = { width: header.widthPx, height: header.heightPx };
      for (const longEdgePx of request.longEdgesPx) {
        const { width, height } = outputSize(source, longEdgePx);
        levels.push({
          widthPx: width,
          heightPx: height,
          rgba: premultiplyAlpha(renderFixtureImage(request.bytes, width, height)),
        });
      }
    } else if (options.bitmaps === undefined && isGif(new Uint8Array(request.bytes))) {
      levels.push(...gifStillLevels(request.bytes, request.longEdgesPx));
    } else {
      const { bitmaps } = options;
      if (bitmaps === undefined) {
        throw new Error('This job worker cannot decode image files: it has no createImageBitmap.');
      }
      const image = await bitmaps.decode(request.bytes, request.mimeType);
      try {
        const source = { width: image.widthPx, height: image.heightPx };
        for (const longEdgePx of request.longEdgesPx) {
          const { width, height } = outputSize(source, longEdgePx);
          levels.push({
            widthPx: width,
            heightPx: height,
            rgba: premultiplyAlpha(await image.readPixels(width, height)),
          });
        }
      } finally {
        image.close();
      }
    }
    return {
      response: { assetId: request.assetId, levels },
      transfer: levels.map(({ rgba }) => rgba.buffer),
    };
  };
}

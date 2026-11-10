/**
 * The `decode` job's bitmap factory in a browser: `createImageBitmap`, and an `OffscreenCanvas`
 * to read the pixels. It lives in the WebWorker-lib project, like the transport, so the engine
 * core stays DOM-free; the types below restate the core's `ImageBitmapFactory` and
 * `DecodedImage`, and `decode-job.test.ts` in the core checks they stay assignable.
 */

/** A decoded `ImageBitmap`, as the core's `DecodedImage`. */
export interface WebDecodedImage {
  /** The decoded width, px. */
  readonly widthPx: number;
  /** The decoded height, px. */
  readonly heightPx: number;
  /**
   * Resizes the bitmap and reads its pixels.
   *
   * @param widthPx - The output width, px.
   * @param heightPx - The output height, px.
   * @returns RGBA, straight alpha, rows top to bottom.
   */
  readPixels(widthPx: number, heightPx: number): Promise<Uint8Array<ArrayBuffer>>;
  /** Frees the bitmap. */
  close(): void;
}

/** The core's `ImageBitmapFactory`, over `createImageBitmap`. */
export interface WebImageBitmapFactory {
  /**
   * Decodes one file.
   *
   * @param bytes - The encoded file.
   * @param mimeType - Its media type, or empty to let the browser sniff it.
   * @returns The decoded image.
   */
  decode(bytes: ArrayBuffer, mimeType: string): Promise<WebDecodedImage>;
}

/** What the factory needs of its global scope: a worker's `self` or a window. */
export interface BitmapScope {
  /** `createImageBitmap`. */
  createImageBitmap(image: ImageBitmapSource, options?: ImageBitmapOptions): Promise<ImageBitmap>;
}

/**
 * Reads a bitmap's pixels at a size: the browser resizes (high quality) and the pixels are read
 * back through a 2D `OffscreenCanvas`, unpremultiplied.
 *
 * @param scope - Where `createImageBitmap` comes from.
 * @param bitmap - The decoded image.
 * @param widthPx - The output width, px.
 * @param heightPx - The output height, px.
 * @returns RGBA, straight alpha.
 */
async function readBitmap(
  scope: BitmapScope,
  bitmap: ImageBitmap,
  widthPx: number,
  heightPx: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const isSameSize = widthPx === bitmap.width && heightPx === bitmap.height;
  const resized = isSameSize
    ? bitmap
    : await scope.createImageBitmap(bitmap, {
        resizeWidth: widthPx,
        resizeHeight: heightPx,
        resizeQuality: 'high',
      });
  try {
    const canvas = new OffscreenCanvas(widthPx, heightPx);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('An OffscreenCanvas offered no 2d context.');
    context.drawImage(resized, 0, 0);
    const { data } = context.getImageData(0, 0, widthPx, heightPx);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } finally {
    if (!isSameSize) resized.close();
  }
}

/**
 * Creates the bitmap factory a job worker passes to `createDefaultJobHandlers` (decoding and
 * resizing never run on the main thread): decode with `createImageBitmap`, resize with it too, read
 * with an `OffscreenCanvas`.
 *
 * @param scope - The worker's `self`.
 * @returns The factory.
 */
export function createBrowserBitmapFactory(scope: BitmapScope): WebImageBitmapFactory {
  return {
    async decode(bytes, mimeType) {
      const blob = mimeType === '' ? new Blob([bytes]) : new Blob([bytes], { type: mimeType });
      const bitmap = await scope.createImageBitmap(blob, { colorSpaceConversion: 'default' });
      return {
        widthPx: bitmap.width,
        heightPx: bitmap.height,
        readPixels: (widthPx, heightPx) => readBitmap(scope, bitmap, widthPx, heightPx),
        close: () => {
          bitmap.close();
        },
      };
    },
  };
}

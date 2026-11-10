/**
 * The glyph job's colour canvas in a browser: an `OffscreenCanvas` to rasterise a
 * colour glyph on, and `createImageBitmap` to decode its bitmap strikes. It lives in the
 * WebWorker-lib project, like the bitmap factory, so the engine core stays DOM-free; a job
 * worker passes it as `createProductionJobHandlers({ colourCanvas })`, where it is checked
 * against the core's `ColourCanvasFactory`.
 */

/** What the factory needs of its global scope: a worker's `self` or a window. */
export interface ColourCanvasScope {
  /** `createImageBitmap`. */
  createImageBitmap(image: ImageBitmapSource): Promise<ImageBitmap>;
}

/** The core's `ColourCanvasFactory`, over `OffscreenCanvas` and `createImageBitmap`. */
export interface WebColourCanvasFactory {
  /**
   * A transparent canvas.
   *
   * @param width - Width, in px.
   * @param height - Height, in px.
   * @returns The canvas.
   */
  create(width: number, height: number): OffscreenCanvas;
  /**
   * Decodes a PNG strike for drawing.
   *
   * @param bytes - The PNG file.
   * @returns The bitmap.
   */
  decodePng(bytes: Uint8Array): Promise<ImageBitmap>;
}

/**
 * Creates the colour canvas a job worker gives the glyph job.
 *
 * @param scope - The worker's `self`.
 * @returns The factory.
 */
export function createBrowserColourCanvas(scope: ColourCanvasScope): WebColourCanvasFactory {
  return {
    create: (width, height) => new OffscreenCanvas(width, height),
    decodePng: (bytes) => scope.createImageBitmap(new Blob([bytes.slice()], { type: 'image/png' })),
  };
}

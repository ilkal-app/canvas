import { meshJob } from '../paths/mesh-job.js';
import type { ColourCanvasFactory } from '../text/colour/colour-canvas.js';
import { layoutJob, preloadLayoutShaper } from '../text/layout/layout-job.js';
import { createMsdfJobHandler } from '../text/msdf/msdf-job.js';
import { createGlyphGeometryJobHandler } from '../text/vector/glyph-geometry-job.js';

import { createDecodeJobHandler, type DecodeJobOptions } from './decode-job.js';
import { framesJob } from './frames-job.js';
import type { JobHandlers } from './job-handlers.js';

/** What a shipped job worker gives its handlers from the browser. */
export interface ProductionJobOptions extends DecodeJobOptions {
  /**
   * The canvas colour glyphs are rasterised with (`createBrowserColourCanvas` in a job worker,
   *). Without it a colour glyph is drawn as its distance field, in the text's colour.
   */
  readonly colourCanvas?: ColourCanvasFactory;
}

/**
 * Creates the handlers a shipped job worker registers: every real job kind (`layout`, `msdf`
 * with the raster fallback, `glyphGeometry`, the vector glyph tier's triangles, `mesh`, and `decode`, which decodes and resizes images with
 * `options.bitmaps`, `createBrowserBitmapFactory` in a job worker; `frames`, an animated GIF's frames for
 * playback), without the `echo`
 * test handler, so an app's bundle never carries it. A job worker that ships msdfgen overrides
 * `msdf` with `createMsdfJobHandler({ loadMsdfgen })`.
 *
 * @param options - The `decode` job's bitmap factory, without which only fixture images decode,
 *   and the `msdf` job's colour canvas.
 * @returns The handlers, by kind.
 */
export function createProductionJobHandlers(options: ProductionJobOptions = {}): JobHandlers {
  // A job worker shapes its layouts: its shaper starts loading with the worker.
  void preloadLayoutShaper();
  return {
    layout: layoutJob,
    msdf: createMsdfJobHandler(
      options.colourCanvas === undefined ? {} : { colourCanvas: options.colourCanvas },
    ),
    glyphGeometry: createGlyphGeometryJobHandler(),
    mesh: meshJob,
    decode: createDecodeJobHandler(options),
    frames: framesJob,
  };
}

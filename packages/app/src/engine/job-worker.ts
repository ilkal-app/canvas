// The job worker: the job pool's worker side, with the engine's shipped handlers
// (`mesh` builds path meshes; `layout`; `msdf` with the raster fallback and colour glyphs drawn
// on an OffscreenCanvas; `decode` given the
// browser's createImageBitmap, so images are decoded and resized here and never on the
// thread that renders), never the `echo` test handler. The engine's pools start it: from the
// engine worker for the worker host, from the page for the main-thread host
// (spawn-job-worker.ts). Vite bundles it from the `new URL` there.
import {
  createBrowserBitmapFactory,
  createBrowserColourCanvas,
  createProductionJobHandlers,
  createWorkerEntry,
  serveWorkerEntry,
} from '@canvas/engine';

serveWorkerEntry(
  self,
  createWorkerEntry(
    createProductionJobHandlers({
      bitmaps: createBrowserBitmapFactory(self),
      colourCanvas: createBrowserColourCanvas(self),
    }),
  ),
);

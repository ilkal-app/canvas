// The engine worker: the engine's side of the host protocol on this dedicated worker's
// `self`, with the shell's overlay layer (the select tool's over the trace tint,
// `shell-overlay.ts`), the text pass's fonts (the page fetches
// each file once and posts the bytes here, `withFontFiles`), the image assets (over the
// page's port) and the
// job workers its one pool starts, since a function cannot cross from the page.
// spawn-engine-worker.ts starts it; Vite bundles it from the `new URL` there.
import {
  createBrowserHostPlatform,
  createEngineWorkerEntry,
  FontLibrary,
  serveWorkerEntry,
} from '@canvas/engine';

import { withFontFiles } from '../text-input/worker-font-files.js';

import { createImageSupport } from './image-support.js';
import { createShellOverlay } from './shell-overlay.js';
import { engineJobWorkers } from './spawn-job-worker.js';

/** The text pass's fonts: empty until the page's font files arrive. */
const fonts = new FontLibrary();

serveWorkerEntry(
  self,
  withFontFiles(
    createEngineWorkerEntry(createBrowserHostPlatform(self), {
      createOverlay: createShellOverlay,
      createTextResources: () => fonts,
      // Path meshes, text layout and glyphs are made, and images decoded, in job workers this
      // worker starts.
      jobWorkers: engineJobWorkers(self),
      // The image assets, from the page's port that `engine-init` carried.
      createImages: createImageSupport,
    }),
    fonts,
    (error) => {
      reportError(error);
    },
  ),
);

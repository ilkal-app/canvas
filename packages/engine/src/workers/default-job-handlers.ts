import { echoJob } from './echo-job.js';
import type { JobHandlers } from './job-handlers.js';
import {
  createProductionJobHandlers,
  type ProductionJobOptions,
} from './production-job-handlers.js';

/**
 * Creates every handler the engine has: the shipped ones (`createProductionJobHandlers`) and the
 * `echo` handler that proves the pool end to end in tests and harnesses. A kind without a
 * handler is answered with a `no-handler` failure. The `msdf` handler here has no msdfgen
 * loader, so it makes raster-fallback glyphs. The `decode` handler decodes image files only with
 * `options.bitmaps` (`createBrowserBitmapFactory` in a job worker); without it, only fixture
 * images.
 *
 * @param options - The `decode` job's bitmap factory and the `msdf` job's colour canvas.
 * @returns The handlers, by kind.
 */
export function createDefaultJobHandlers(options: ProductionJobOptions = {}): JobHandlers {
  // This registration runs in real job workers (with msdfgen's wasm for `msdf`) in the golden
  // harness: tooling/golden/harness/specs/job-workers.spec.ts.
  return { echo: echoJob, ...createProductionJobHandlers(options) };
}

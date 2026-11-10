import type { GpuBackend, GpuDeviceLoss } from '../gpu/gpu-backend.js';
import type { GpuBackendName } from '../gpu/gpu-capabilities.js';
import type { AssetSource } from '../images/asset-source.js';
import type { FontLibrary } from '../text/font/font-library.js';
import type { FontFaceSource } from '../text/scene/text-pass-resources.js';
import type { JobHandler } from '../workers/job-handlers.js';

import type { EngineCanvas } from './engine-host-platform.js';
import type { EngineJobWorkers } from './engine-job-workers.js';
import type { EngineOverlayFactory } from './engine-overlay.js';

/**
 * What the engine needs to draw images: the assets. Code, not data, so
 * the engine worker's script creates them there (the page's options cannot carry them). Images
 * are decoded and resized by `decode` jobs on the engine's job pool, in the job workers
 * (`EngineExtensions.jobWorkers`), whose script registers the handler with the browser's
 * `createImageBitmap` (`createBrowserBitmapFactory`).
 */
export interface EngineImageSupport {
  /** Where image descriptions and bytes come from (the app's adapter, or a fixture source). */
  readonly assets: AssetSource;
  /**
   * The `decode` handler the pool runs on the engine's own thread when it has no job workers
   * (or all failed). Omitted, the default, such decodes fail and those images keep their
   * placeholder: a thread that renders never decodes an image file. Tests and golden
   * scenes pass `createDecodeJobHandler()`, which renders only the fixture source's images.
   */
  readonly decodeFallback?: JobHandler<'decode'>;
  /**
   * Releases what the support opened for this engine (the adapter's event stream, a harness
   * channel), once the engine that received it is destroyed. Optional.
   */
  close?(): void;
}

/** What the thread that renders adds to the engine: code, which no message can carry. */
export interface EngineExtensions {
  /** Creates the layer the page's `setOverlay` models are drawn by (the selection overlay). */
  readonly createOverlay?: EngineOverlayFactory;
  /**
   * Creates the text pass's fonts from the font files the host's options name
   * (`EngineHostOptions.fontFaces`): the app loads them here, where the engine renders. The text
   * pass's jobs go to the runtime's one pool (`EngineJobs`).
   */
  readonly createTextResources?: (fontFaces: readonly FontFaceSource[]) => FontLibrary;
  /** The image assets; without them image objects draw their placeholder colour. */
  readonly images?: EngineImageSupport;
  /**
   * The job workers the engine's pool starts (path meshes are built there); without them, jobs
   * run on the engine's thread after each frame.
   */
  readonly jobWorkers?: EngineJobWorkers;
}

/** What `recreateBackend` builds: the backend, and the canvas it draws on when not the old one. */
export interface RecreatedBackend {
  /** The new backend. */
  readonly backend: GpuBackend;
  /** The canvas it draws on, when it is a fresh one; absent for the same canvas. */
  readonly canvas?: EngineCanvas;
}

/**
 * Builds a new backend after a device loss.
 *
 * @param loss - The loss.
 * @param lostBackend - Which backend was lost.
 * @returns The new backend, and its canvas when that is a fresh one.
 */
export type RecreateBackend = (
  loss: GpuDeviceLoss,
  lostBackend: GpuBackendName,
) => Promise<RecreatedBackend>;

/** An {@link EngineExtensions} plus what only the runtime's creator can supply. */
export interface EngineRuntimeExtensions extends EngineExtensions {
  /**
   * Builds a new backend after the device was lost, told which backend
   * was lost: for the same canvas, or for a fresh `canvas` it returns (a canvas that had
   * a WebGPU context can never have a WebGL2 one, so a switch after a WebGPU loss needs one).
   * Without it a lost device is reported as a fault and the engine stops drawing.
   */
  readonly recreateBackend?: RecreateBackend;
}

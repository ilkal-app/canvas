import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { Frame } from '../scene/frame.js';

/**
 * A layer the engine host draws over the scene from plain-data models the page sends with
 * `EngineHost.setOverlay` (the tools stay on the page, the engine renders what they show). The
 * select tool's overlay is one: the page sends its model (the selection frame, outlines, handles
 * and marquee in world units), and the layer, created on the rendering thread, turns it into
 * rectangles at each frame's zoom, so the outlines keep their screen width even through a camera
 * glide the page never sees. The engine does not know a model's shape; the layer checks it, since a
 * model may have crossed a thread. Runs on the thread that renders.
 */
export interface EngineOverlay {
  /**
   * Adds the layer's stages to the host's frame; called once, when the host starts, before any
   * frame statistics are installed, so its stages are timed with the rest.
   *
   * @param frame - The host renderer's frame.
   */
  install(frame: Frame): void;
  /**
   * Shows a model from the next frame on.
   *
   * @param model - What the page sent, structured-cloned when it crossed to a worker.
   * @returns `false` when the layer cannot use the model (it is then ignored and reported as a
   *   fault); `true` otherwise.
   */
  setModel(model: unknown): boolean;
  /** Frees the layer's GPU resources; the backend stays alive. */
  destroy(): void;
}

/**
 * Creates the overlay layer for a host's backend, on the thread that renders: the app passes one
 * to `createEngineHost` (for the main-thread host) and to `createEngineWorkerEntry` in its engine
 * worker's script (for the worker host), since a function cannot cross to a worker.
 *
 * @param backend - The backend the host draws with.
 * @returns The layer.
 */
export type EngineOverlayFactory = (backend: GpuBackend) => EngineOverlay;

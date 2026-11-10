import type { CreateGpuBackendOptions } from '../gpu/create-gpu-backend.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';

/**
 * A canvas the engine draws into, page `HTMLCanvasElement` or worker `OffscreenCanvas`, as the
 * DOM-free engine core sees it: its drawing buffer size in device px, which a resize sets.
 */
export interface EngineCanvas {
  /** Drawing buffer width, device px. */
  width: number;
  /** Drawing buffer height, device px. */
  height: number;
}

/** Animation frames and the clock of the thread that renders: the page's, or the engine worker's. */
export interface FrameScheduler {
  /**
   * The time now on this thread's clock (`performance.now()`), the clock frame timestamps use;
   * the stage timers read it.
   *
   * @returns ms since this thread's clock origin.
   */
  now(): number;
  /**
   * Runs `callback` before the thread's next frame is presented.
   *
   * @param callback - Receives the frame's timestamp, ms on this thread's clock.
   * @returns A handle for {@link FrameScheduler.cancelAnimationFrame}.
   */
  requestAnimationFrame(callback: (timeMs: number) => void): number;
  /**
   * Cancels a requested frame callback.
   *
   * @param handle - What `requestAnimationFrame` returned.
   */
  cancelAnimationFrame(handle: number): void;
}

/**
 * What the engine needs from the thread it renders on: animation frames, the thread's clock
 * origin and a GPU backend for its canvas. The engine core is DOM-free, so the browser's
 * implementation, `createBrowserHostPlatform(self)`, is injected (it works on the page and in
 * the engine worker alike).
 */
export interface EngineThreadPlatform extends FrameScheduler {
  /** `performance.timeOrigin` of this thread, ms since the epoch: converts clocks between threads. */
  readonly timeOriginMs: number;
  /**
   * Whether this thread's scope has `requestAnimationFrame`: `false` where frames fall back to a
   * timer, and a worker then takes its frames from the page's ticks (`withPageFrameTicks`,
   *). Taken as `true` if absent.
   */
  readonly hasAnimationFrames?: boolean;
  /**
   * Creates the GPU backend for a canvas of this thread (`createGpuBackend`).
   *
   * @param canvas - The page canvas or the worker's `OffscreenCanvas`.
   * @param options - Backend preference and sample count.
   * @returns The backend.
   */
  createBackend(canvas: EngineCanvas, options: CreateGpuBackendOptions): Promise<GpuBackend>;
}

/**
 * The page's platform: the thread platform plus what choosing and starting the worker host
 * needs. Main thread only.
 */
export interface EngineHostPlatform extends EngineThreadPlatform {
  /**
   * Whether a dedicated worker can render into a canvas transferred from the page:
   * `OffscreenCanvas`, `transferControlToOffscreen` and a GPU context on an `OffscreenCanvas`.
   *
   * @returns `true` when the worker host can run here.
   */
  canRenderInWorker(): boolean;
  /**
   * Hands control of a page canvas to an `OffscreenCanvas` that can be transferred to a
   * worker. Once done, the page canvas only shows what the worker draws and cannot be resized
   * or given a context.
   *
   * @param canvas - The page canvas.
   * @returns Its `OffscreenCanvas`, to transfer to the worker.
   * @throws {Error} When the canvas cannot hand over control (not a page canvas, already handed
   *   over, or already holding a context).
   */
  transferControlToOffscreen(canvas: EngineCanvas): EngineCanvas;
}

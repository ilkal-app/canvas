/**
 * The engine host's browser platform: animation frames, the clock origin, handing a page
 * canvas to a worker and creating GPU backends, for the page and for the engine worker alike.
 * The only engine host code that touches browser globals; its own TypeScript project with the
 * DOM lib, so the engine core stays DOM-free (Global Constraint 2).
 *
 * This project cannot import the engine core (the core references it), so the types below
 * restate the core's `EngineHostPlatform` shape; `browser-host-platform-shape.test.ts` in the
 * core checks they stay assignable.
 */
import { createGpuBackend, type CreateGpuBackendOptions } from '../../gpu/create-gpu-backend.js';
import type { GpuBackend } from '../../gpu/gpu-backend.js';
import type { GpuCanvas } from '../../gpu/gpu-canvas.js';

/** A canvas as the engine core passes it: anything with a drawing buffer size. */
export interface SizedCanvas {
  /** Drawing buffer width, device px. */
  width: number;
  /** Drawing buffer height, device px. */
  height: number;
}

/** The part of a scope's `performance` the platform reads. */
export interface BrowserHostClock {
  /** When the scope's clock started, ms since the epoch. */
  readonly timeOrigin: number;
  /**
   * The time now on the scope's clock.
   *
   * @returns ms since `timeOrigin`.
   */
  now(): number;
}

/**
 * What the platform needs of the global scope it runs in: the page's `window` or the engine
 * worker's `self`. Both qualify, so the same code serves either thread.
 */
export interface BrowserHostScope {
  /** The scope's clock. */
  readonly performance: BrowserHostClock;
  /**
   * Animation frames; dedicated workers have them where `OffscreenCanvas` rendering exists.
   *
   * @param callback - Receives the frame time, ms.
   * @returns A handle.
   */
  requestAnimationFrame?(callback: (timeMs: number) => void): number;
  /**
   * Cancels an animation frame callback.
   *
   * @param handle - Its handle.
   */
  cancelAnimationFrame?(handle: number): void;
  /**
   * Timers, the fallback where a worker has no animation frames.
   *
   * @param callback - What to run.
   * @param delayMs - After how long, ms.
   * @returns A handle.
   */
  setTimeout(callback: () => void, delayMs: number): number;
  /**
   * Cancels a timer.
   *
   * @param handle - Its handle.
   */
  clearTimeout(handle: number): void;
}

/** The browser's engine host platform: the core's `EngineHostPlatform`, restated. */
export interface BrowserHostPlatform {
  /** Whether the scope has its own animation frames (a worker may not:). */
  readonly hasAnimationFrames: boolean;
  /** `performance.timeOrigin` of the scope, ms since the epoch. */
  readonly timeOriginMs: number;
  /**
   * The time now on the scope's clock.
   *
   * @returns `performance.now()`, ms.
   */
  now(): number;
  /**
   * Runs `callback` on the scope's next animation frame.
   *
   * @param callback - Receives the frame time, ms on the scope's clock.
   * @returns A handle.
   */
  requestAnimationFrame(callback: (timeMs: number) => void): number;
  /**
   * Cancels a frame callback.
   *
   * @param handle - Its handle.
   */
  cancelAnimationFrame(handle: number): void;
  /**
   * Creates the GPU backend for a page canvas or an `OffscreenCanvas`.
   *
   * @param canvas - The canvas.
   * @param options - Backend preference and sample count.
   * @returns The backend; rejects when `canvas` is not a canvas or no backend can be created.
   */
  createBackend(canvas: SizedCanvas, options: CreateGpuBackendOptions): Promise<GpuBackend>;
  /**
   * Whether a worker can render into a canvas transferred from this page.
   *
   * @returns `true` where `OffscreenCanvas`, `transferControlToOffscreen`, workers and an
   *   `OffscreenCanvas` WebGL2 context (the worker's fallback backend) all exist.
   */
  canRenderInWorker(): boolean;
  /**
   * Hands a page canvas's control to an `OffscreenCanvas` for the worker.
   *
   * @param canvas - The page canvas.
   * @returns Its `OffscreenCanvas`.
   * @throws {TypeError} When `canvas` is not a page canvas.
   * @throws {DOMException} When it already handed over control or holds a context.
   */
  transferControlToOffscreen(canvas: SizedCanvas): OffscreenCanvas;
}

/** Frame period of the timer fallback, ms (60 Hz). */
const FALLBACK_FRAME_MS = 16;

function isPageCanvas(canvas: SizedCanvas): canvas is HTMLCanvasElement {
  return typeof HTMLCanvasElement === 'function' && canvas instanceof HTMLCanvasElement;
}

function isGpuCanvas(canvas: SizedCanvas): canvas is GpuCanvas {
  return (
    isPageCanvas(canvas) ||
    (typeof OffscreenCanvas === 'function' && canvas instanceof OffscreenCanvas)
  );
}

/**
 * Probes, once, whether workers can render into a transferred canvas: every API exists and an
 * `OffscreenCanvas` offers WebGL2, the backend a worker falls back to when it has no WebGPU. The
 * 1 × 1 probe context is left to the garbage collector: losing it on purpose makes Firefox report
 * "WebGL context was lost", which must stay a sign of a real loss.
 *
 * @returns Whether the worker host can run on this page.
 */
function probeWorkerRendering(): boolean {
  const hasApis =
    typeof OffscreenCanvas === 'function' &&
    typeof Worker === 'function' &&
    typeof HTMLCanvasElement === 'function' &&
    'transferControlToOffscreen' in HTMLCanvasElement.prototype;
  if (!hasApis) return false;
  try {
    return new OffscreenCanvas(1, 1).getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/**
 * Creates the engine host platform for a global scope: `createBrowserHostPlatform(window)` on
 * the page (for `createEngineHost`), `createBrowserHostPlatform(self)` in the engine worker
 * (for `createEngineWorkerEntry`). Where the scope has no animation frames it falls back to a
 * 16 ms timer stamped with `performance.now()`, and says so (`hasAnimationFrames`), so a worker
 * takes the page's ticks instead.
 *
 * @param scope - The page's `window` or the worker's `self`.
 * @returns The platform.
 */
export function createBrowserHostPlatform(scope: BrowserHostScope): BrowserHostPlatform {
  let canRender: boolean | undefined;
  const hasAnimationFrames =
    typeof scope.requestAnimationFrame === 'function' &&
    typeof scope.cancelAnimationFrame === 'function';
  const frames =
    hasAnimationFrames && scope.requestAnimationFrame && scope.cancelAnimationFrame
      ? {
          request: scope.requestAnimationFrame.bind(scope),
          cancel: scope.cancelAnimationFrame.bind(scope),
        }
      : {
          request: (callback: (timeMs: number) => void) =>
            scope.setTimeout(() => {
              callback(scope.performance.now());
            }, FALLBACK_FRAME_MS),
          cancel: (handle: number) => {
            scope.clearTimeout(handle);
          },
        };
  return {
    timeOriginMs: scope.performance.timeOrigin,
    hasAnimationFrames,
    now: () => scope.performance.now(),
    requestAnimationFrame: frames.request,
    cancelAnimationFrame: frames.cancel,
    createBackend: (canvas, options) =>
      isGpuCanvas(canvas)
        ? createGpuBackend(canvas, options)
        : Promise.reject(new TypeError('The engine can draw only into a canvas.')),
    canRenderInWorker: () => {
      canRender ??= probeWorkerRendering();
      return canRender;
    },
    transferControlToOffscreen: (canvas) => {
      if (!isPageCanvas(canvas)) {
        throw new TypeError('Only a page canvas can hand its control to a worker.');
      }
      return canvas.transferControlToOffscreen();
    },
  };
}

// The page's side of a worker engine's switch to WebGL2 after a WebGPU loss: a canvas
// that had a WebGPU context can never have a WebGL2 one, so the page lays a fresh canvas over its
// own and hands that canvas's control to the worker.
import type { GpuBackendName } from '../gpu/gpu-capabilities.js';

import type { EngineCanvas } from './engine-host-platform.js';
import {
  overlayFallbackCanvas,
  removeFallbackCanvas,
  sizeFallbackCanvas,
} from './fallback-canvas.js';
import { toError } from './frame-reads.js';
import type { EngineWorkerTransport } from './worker-engine-host.js';

/** How the page gives an engine worker a fresh canvas after a WebGPU loss. */
export interface WorkerCanvasFallback {
  /** The page canvas whose control the worker has; the fallback is laid over it. */
  readonly pageCanvas: EngineCanvas;
  /**
   * Hands a page canvas's control to an `OffscreenCanvas` (`EngineHostPlatform`).
   *
   * @param canvas - The fallback page canvas.
   * @returns Its `OffscreenCanvas`, to transfer to the worker.
   */
  readonly transferControlToOffscreen: (canvas: EngineCanvas) => EngineCanvas;
  /**
   * Called once the worker draws with the new backend.
   *
   * @param name - The new backend.
   */
  readonly onBackendChanged?: (name: GpuBackendName) => void;
}

/** The fallback canvas of one worker engine host, once the worker asked for it. */
export class WorkerCanvasSwitch {
  private canvas: EngineCanvas | undefined;

  /**
   * Creates the switch; it does nothing until the worker asks for a canvas.
   *
   * @param fallback - How to make the fallback; without it a WebGPU loss cannot be recovered.
   */
  constructor(private readonly fallback: WorkerCanvasFallback | undefined) {}

  /**
   * Answers the worker's request for a canvas, always, so its recovery never waits for nothing:
   * with the `OffscreenCanvas` of a fresh canvas laid over the page canvas, or with no canvas
   * (the worker retries WebGPU on its own) when there is no way to make one or handing it over
   * failed, in which case the fallback comes off the page again.
   *
   * @param transport - The engine worker.
   * @param onFault - Told when making, handing over or posting the canvas failed.
   */
  handOver(transport: Pick<EngineWorkerTransport, 'post'>, onFault: (error: Error) => void): void {
    try {
      const offscreen = this.overlay();
      if (offscreen !== undefined) {
        transport.post({ type: 'engine-fallback-canvas', canvas: offscreen }, [offscreen]);
        return;
      }
    } catch (error) {
      this.destroy();
      onFault(toError(error));
    }
    try {
      transport.post({ type: 'engine-fallback-canvas' }, []);
    } catch (error) {
      onFault(toError(error));
    }
  }

  /** Takes the fallback off the page, if there is one, and shows the page canvas again. */
  destroy(): void {
    if (this.canvas !== undefined && this.fallback !== undefined)
      removeFallbackCanvas(this.fallback.pageCanvas, this.canvas);
    this.canvas = undefined;
  }

  /**
   * Lays the fallback over the page canvas and hands its control over.
   *
   * @returns The fallback's `OffscreenCanvas`, or `undefined` when none can be made.
   */
  private overlay(): EngineCanvas | undefined {
    if (this.fallback === undefined) return undefined;
    this.canvas = overlayFallbackCanvas(this.fallback.pageCanvas);
    return this.canvas && this.fallback.transferControlToOffscreen(this.canvas);
  }

  /**
   * Keeps the fallback's CSS box on the page canvas's after a resize; nothing before a switch.
   *
   * @param widthPx - The drawing buffer's width.
   * @param heightPx - The drawing buffer's height.
   * @param dpr - Device pixels per CSS pixel.
   */
  resize(widthPx: number, heightPx: number, dpr: number): void {
    if (this.canvas !== undefined) sizeFallbackCanvas(this.canvas, widthPx, heightPx, dpr);
  }

  /**
   * Tells the page the worker draws with a new backend.
   *
   * @param name - The new backend.
   */
  backendChanged(name: GpuBackendName): void {
    this.fallback?.onBackendChanged?.(name);
  }
}

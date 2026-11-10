// How an engine host rebuilds a lost backend. A lost WebGL2 context is restored on its
// canvas. A canvas that had a WebGPU context can never have a WebGL2 one, so after a WebGPU loss
// the engine goes on with WebGL2 on a fresh canvas, at the size the old one had; where no fresh
// canvas can be had, it asks for WebGPU on its own canvas again.
import type { CreateGpuBackendOptions } from '../gpu/create-gpu-backend.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';

import type { RecreateBackend } from './engine-extensions.js';
import type { EngineCanvas, EngineThreadPlatform } from './engine-host-platform.js';

/**
 * Creates a host's `recreateBackend`: on the canvas the engine draws on after a WebGL2 loss,
 * on a fresh canvas with WebGL2 after a WebGPU loss.
 *
 * @param platform - Creates the backends.
 * @param canvas - The canvas the first backend draws on.
 * @param backendOptions - The host's backend options.
 * @param fallbackCanvas - Gets the fresh canvas for a switch, or `undefined` when there is none.
 * @param onBackend - Called with each backend built, and whether it switched canvas.
 * @returns The factory, for `EngineRuntimeExtensions.recreateBackend`.
 */
export function switchingBackendFactory(
  platform: Pick<EngineThreadPlatform, 'createBackend'>,
  canvas: EngineCanvas,
  backendOptions: CreateGpuBackendOptions,
  fallbackCanvas: () => EngineCanvas | undefined | Promise<EngineCanvas | undefined>,
  onBackend: (backend: GpuBackend, isSwitch: boolean) => void,
): RecreateBackend {
  // What the engine draws on now, and with: WebGL2 on the fallback once it switched.
  let current = { canvas, options: backendOptions };
  return async (...[, lostBackend]) => {
    const fallback = lostBackend === 'webgpu' ? await fallbackCanvas() : undefined;
    if (fallback === undefined) {
      const backend = await platform.createBackend(current.canvas, current.options);
      onBackend(backend, false);
      return { backend };
    }
    fallback.width = current.canvas.width;
    fallback.height = current.canvas.height;
    const options: CreateGpuBackendOptions = { ...backendOptions, prefer: 'webgl2' };
    const backend = await platform.createBackend(fallback, options);
    current = { canvas: fallback, options };
    onBackend(backend, true);
    return { backend, canvas: fallback };
  };
}

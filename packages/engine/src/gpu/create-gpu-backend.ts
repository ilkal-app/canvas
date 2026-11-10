import { selectGpuBackend } from './backend-selection.js';
import type { GpuBackend } from './gpu-backend.js';
import type { GpuCanvas } from './gpu-canvas.js';
import type { GpuBackendName, GpuSampleCount } from './gpu-capabilities.js';
import { createWebGl2Backend } from './webgl2/webgl2-backend.js';
import { createWebGpuBackend } from './webgpu/create-webgpu-backend.js';

/** Options for {@link createGpuBackend}. */
export interface CreateGpuBackendOptions {
  /** The backend to try first; the other is the fallback. Default `webgpu`. */
  readonly prefer?: GpuBackendName;
  /** Samples per pixel: 4 antialiases edges (path fills rely on it), 1 does not. Default 4. */
  readonly sampleCount?: GpuSampleCount;
}

/**
 * Creates the GPU backend for a canvas: WebGPU when the browser exposes `navigator.gpu` and an
 * adapter, else WebGL2. Read `capabilities.backendName` to learn which
 * one runs; a caller that needs a specific backend (the parity test) checks it.
 *
 * @param canvas - The page canvas or worker `OffscreenCanvas` to draw into.
 * @param options - Backend preference and sample count.
 * @returns The first backend that could be created.
 * @throws {Error} When neither backend can be created; the message names each reason.
 */
export function createGpuBackend(
  canvas: GpuCanvas,
  options: CreateGpuBackendOptions = {},
): Promise<GpuBackend> {
  const sampleCount = options.sampleCount ?? 4;
  return selectGpuBackend(options.prefer ?? 'webgpu', {
    webgpu: () => createWebGpuBackend(canvas, sampleCount),
    webgl2: () => Promise.resolve(createWebGl2Backend(canvas, sampleCount)),
  });
}

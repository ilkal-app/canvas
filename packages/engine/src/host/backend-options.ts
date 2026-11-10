import type { CreateGpuBackendOptions } from '../gpu/create-gpu-backend.js';

import type { EngineHostOptions } from './engine-host.js';

/**
 * The backend options an engine host's options ask for.
 *
 * @param options - The host options.
 * @returns `createGpuBackend` options: the preferred backend (WebGPU by default) and sample count.
 */
export function backendOptionsOf(options: EngineHostOptions): CreateGpuBackendOptions {
  return {
    prefer: options.backend ?? 'webgpu',
    ...(options.sampleCount === undefined ? {} : { sampleCount: options.sampleCount }),
  };
}

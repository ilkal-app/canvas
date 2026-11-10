import type { GpuBackend } from './gpu-backend.js';
import type { GpuBackendName } from './gpu-capabilities.js';

/**
 * Tries to create one backend. Resolves to `undefined` when the browser lacks it (no
 * `navigator.gpu`, no adapter, no `webgl2` context) and rejects when creation fails midway.
 * A probe must not claim the canvas unless it succeeds: a canvas holds one context type.
 */
export type GpuBackendProbe = () => Promise<GpuBackend | undefined>;

/** One probe per backend. */
export type GpuBackendProbes = Readonly<Record<GpuBackendName, GpuBackendProbe>>;

/**
 * The order backends are tried in: the preferred one, then the other (WebGPU first, with a
 * WebGL2 peer).
 *
 * @param prefer - The backend to try first.
 * @returns Both backend names, preferred first.
 */
export function backendAttemptOrder(prefer: GpuBackendName): readonly GpuBackendName[] {
  return prefer === 'webgpu' ? ['webgpu', 'webgl2'] : ['webgl2', 'webgpu'];
}

/**
 * Creates the first backend whose probe succeeds, in {@link backendAttemptOrder}. A probe that
 * rejects counts as unavailable, so a failing WebGPU device falls back to WebGL2.
 *
 * @param prefer - The backend to try first.
 * @param probes - How to create each backend.
 * @returns The first backend created.
 * @throws {Error} When every probe is unavailable or fails; the message names each reason.
 */
export async function selectGpuBackend(
  prefer: GpuBackendName,
  probes: GpuBackendProbes,
): Promise<GpuBackend> {
  const failures: string[] = [];
  for (const name of backendAttemptOrder(prefer)) {
    try {
      const backend = await probes[name]();
      if (backend) {
        return backend;
      }
      failures.push(`${name}: unavailable`);
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No GPU backend could be created (${failures.join('; ')}).`);
}

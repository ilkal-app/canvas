import type { GpuCapabilities } from '../gpu-capabilities.js';
import { isSoftwareAdapterName } from '../software-adapter.js';

/**
 * The adapter and device facts capability resolution needs, as plain data so it is testable
 * without a GPU (a `GPUAdapterInfo` and a device's `features` fit it).
 */
export interface WebGpuAdapterFacts {
  /** The device's `limits.maxTextureDimension2D`, in texels. */
  readonly maxTextureDimension2D: number;
  /** The features the device was created with. */
  readonly features: ReadonlySet<string>;
  /** The adapter's identification. */
  readonly info: {
    readonly vendor: string;
    readonly architecture: string;
    readonly description: string;
    readonly isFallbackAdapter?: boolean;
  };
  /** Samples per pixel the backend renders with, as requested. */
  readonly sampleCount: number;
}

/**
 * Resolves the capabilities of a WebGPU device.
 *
 * @param facts - The adapter's identification and the device's limits and features.
 * @returns The backend's capabilities.
 */
export function resolveWebGpuCapabilities(facts: WebGpuAdapterFacts): GpuCapabilities {
  const { info } = facts;
  const adapterName = info.description || `${info.vendor} ${info.architecture}`.trim();
  return {
    backendName: 'webgpu',
    maxTextureSize: facts.maxTextureDimension2D,
    hasTimestampQuery: facts.features.has('timestamp-query'),
    sampleCount: facts.sampleCount,
    adapterName,
    isSoftwareAdapter: info.isFallbackAdapter === true || isSoftwareAdapterName(adapterName),
  };
}

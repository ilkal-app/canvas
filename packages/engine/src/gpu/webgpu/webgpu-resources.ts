import type { GpuBindGroup, GpuBindGroupEntry } from '../gpu-bind-group.js';
import type { GpuBuffer, GpuBufferUsage } from '../gpu-buffer.js';
import type {
  GpuAddressMode,
  GpuFilterMode,
  GpuSampler,
  GpuTexture,
  GpuTextureFormat,
} from '../gpu-texture.js';

/** Every WebGPU handle remembers its device, so another backend's handles are rejected. */
interface WebGpuOwned {
  readonly device: GPUDevice;
}

/**
 * Returns `resource` as a handle of `type` owned by `device`.
 *
 * @param resource - A handle passed to the backend.
 * @param type - The WebGPU handle class expected.
 * @param device - The backend's device.
 * @returns The handle, narrowed.
 * @throws {TypeError} When the handle belongs to another backend.
 */
export function claimWebGpu<T extends WebGpuOwned>(
  resource: unknown,
  type: abstract new (...args: never[]) => T,
  device: GPUDevice,
): T {
  if (resource instanceof type && resource.device === device) {
    return resource;
  }
  throw new TypeError(`A ${type.name} handle was passed to a backend that did not create it.`);
}

/** A WebGPU buffer with `COPY_DST` plus `VERTEX` or `UNIFORM` usage. */
export class WebGpuBuffer implements GpuBuffer, WebGpuOwned {
  /**
   * Wraps a created buffer.
   *
   * @param device - The owning device.
   * @param handle - The WebGPU buffer.
   * @param usage - What the buffer is bound as.
   */
  constructor(
    readonly device: GPUDevice,
    readonly handle: GPUBuffer,
    readonly usage: GpuBufferUsage,
  ) {}

  /**
   * Size in bytes.
   *
   * @returns The buffer's size.
   */
  get byteLength(): number {
    return this.handle.size;
  }

  /** Frees the WebGPU buffer. */
  destroy(): void {
    this.handle.destroy();
  }
}

/** A WebGPU 2D texture with `TEXTURE_BINDING | COPY_DST` usage and its default view. */
export class WebGpuTexture implements GpuTexture, WebGpuOwned {
  /** The view bind groups use. */
  readonly view: GPUTextureView;

  /**
   * Wraps a created texture.
   *
   * @param device - The owning device.
   * @param handle - The WebGPU texture.
   * @param format - The texel format.
   */
  constructor(
    readonly device: GPUDevice,
    readonly handle: GPUTexture,
    readonly format: GpuTextureFormat,
  ) {
    this.view = handle.createView();
  }

  /**
   * Width in texels.
   *
   * @returns The texture's width.
   */
  get width(): number {
    return this.handle.width;
  }

  /**
   * Height in texels.
   *
   * @returns The texture's height.
   */
  get height(): number {
    return this.handle.height;
  }

  /** Frees the WebGPU texture. */
  destroy(): void {
    this.handle.destroy();
  }
}

/** A WebGPU sampler. */
export class WebGpuSampler implements GpuSampler, WebGpuOwned {
  /**
   * Wraps a created sampler.
   *
   * @param device - The owning device.
   * @param handle - The WebGPU sampler.
   * @param filter - Filtering in both directions.
   * @param addressMode - Wrapping in both directions.
   */
  constructor(
    readonly device: GPUDevice,
    readonly handle: GPUSampler,
    readonly filter: GpuFilterMode,
    readonly addressMode: GpuAddressMode,
  ) {}

  /** Does nothing: WebGPU releases samplers by garbage collection, and with their device. */
  destroy(): void {
    // No explicit release exists in WebGPU.
  }
}

/** A WebGPU bind group for group 0. */
export class WebGpuBindGroup implements GpuBindGroup, WebGpuOwned {
  /**
   * Wraps a created bind group.
   *
   * @param device - The owning device.
   * @param handle - The WebGPU bind group.
   * @param entries - The resources as given.
   */
  constructor(
    readonly device: GPUDevice,
    readonly handle: GPUBindGroup,
    readonly entries: readonly GpuBindGroupEntry[],
  ) {}
}

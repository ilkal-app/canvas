import type { GpuBindGroup, GpuBindGroupEntry } from '../gpu-bind-group.js';
import type { GpuBuffer, GpuBufferUsage } from '../gpu-buffer.js';
import type {
  GpuAddressMode,
  GpuFilterMode,
  GpuSampler,
  GpuTexture,
  GpuTextureFormat,
} from '../gpu-texture.js';
import type { ResourceTracker } from '../resource-tracker.js';

/** Every WebGL2 handle remembers its context, so another backend's handles are rejected. */
interface WebGl2Owned {
  readonly gl: WebGL2RenderingContext;
}

/**
 * Returns `resource` as a handle of `type` owned by `gl`.
 *
 * @param resource - A handle passed to the backend.
 * @param type - The WebGL2 handle class expected.
 * @param gl - The backend's context.
 * @returns The handle, narrowed.
 * @throws {TypeError} When the handle belongs to another backend.
 */
export function claimWebGl2<T extends WebGl2Owned>(
  resource: unknown,
  type: abstract new (...args: never[]) => T,
  gl: WebGL2RenderingContext,
): T {
  if (resource instanceof type && resource.gl === gl) {
    return resource;
  }
  throw new TypeError(`A ${type.name} handle was passed to a backend that did not create it.`);
}

/** A WebGL2 buffer; `vertex` buffers bind to `ARRAY_BUFFER`, `uniform` to `UNIFORM_BUFFER`. */
export class WebGl2Buffer implements GpuBuffer, WebGl2Owned {
  /**
   * Wraps a created buffer.
   *
   * @param gl - The owning context.
   * @param handle - The GL buffer.
   * @param usage - What the buffer is bound as.
   * @param byteLength - Size in bytes.
   * @param tracker - The backend's live resources; the buffer adds itself.
   */
  constructor(
    readonly gl: WebGL2RenderingContext,
    readonly handle: WebGLBuffer,
    readonly usage: GpuBufferUsage,
    readonly byteLength: number,
    private readonly tracker: ResourceTracker,
  ) {
    tracker.track(this);
  }

  /**
   * The bind target writes use.
   *
   * @returns `UNIFORM_BUFFER` or `ARRAY_BUFFER`.
   */
  get target(): GLenum {
    return this.usage === 'uniform' ? this.gl.UNIFORM_BUFFER : this.gl.ARRAY_BUFFER;
  }

  /** Frees the GL buffer; later calls do nothing. */
  destroy(): void {
    this.gl.deleteBuffer(this.handle);
    this.tracker.untrack(this);
  }
}

/** A WebGL2 2D texture with immutable storage. */
export class WebGl2Texture implements GpuTexture, WebGl2Owned {
  /**
   * Wraps a created texture.
   *
   * @param gl - The owning context.
   * @param handle - The GL texture.
   * @param format - The texel format.
   * @param width - Width in texels.
   * @param height - Height in texels.
   * @param tracker - The backend's live resources; the texture adds itself.
   */
  constructor(
    readonly gl: WebGL2RenderingContext,
    readonly handle: WebGLTexture,
    readonly format: GpuTextureFormat,
    readonly width: number,
    readonly height: number,
    private readonly tracker: ResourceTracker,
  ) {
    tracker.track(this);
  }

  /**
   * The `format` argument of `texSubImage2D` for this texture.
   *
   * @returns `RGBA` or `RED`.
   */
  get uploadFormat(): GLenum {
    return this.format === 'r8unorm' ? this.gl.RED : this.gl.RGBA;
  }

  /** Frees the GL texture; later calls do nothing. */
  destroy(): void {
    this.gl.deleteTexture(this.handle);
    this.tracker.untrack(this);
  }
}

/** A WebGL2 sampler object, bound to the texture unit of the texture it samples. */
export class WebGl2Sampler implements GpuSampler, WebGl2Owned {
  /**
   * Wraps a created sampler.
   *
   * @param gl - The owning context.
   * @param handle - The GL sampler.
   * @param filter - Filtering in both directions.
   * @param addressMode - Wrapping in both directions.
   * @param tracker - The backend's live resources; the sampler adds itself.
   */
  constructor(
    readonly gl: WebGL2RenderingContext,
    readonly handle: WebGLSampler,
    readonly filter: GpuFilterMode,
    readonly addressMode: GpuAddressMode,
    private readonly tracker: ResourceTracker,
  ) {
    tracker.track(this);
  }

  /** Frees the GL sampler object; later calls do nothing. */
  destroy(): void {
    this.gl.deleteSampler(this.handle);
    this.tracker.untrack(this);
  }
}

/** A texture unit's contents: the unit number is the texture's WGSL binding. */
export interface WebGl2TextureUnit {
  /** The texture unit, equal to the texture's binding. */
  readonly unit: number;
  /** The texture bound to it. */
  readonly texture: WebGl2Texture;
  /** The sampler bound to it. */
  readonly sampler: WebGl2Sampler | undefined;
}

/** A WebGL2 bind group: uniform buffers by binding point and textures by unit. */
export class WebGl2BindGroup implements GpuBindGroup, WebGl2Owned {
  /**
   * Holds a bind group's resolved resources.
   *
   * @param gl - The owning context.
   * @param entries - The resources as given.
   * @param uniformBuffers - Uniform buffers; the binding point is the WGSL binding.
   * @param textureUnits - Textures and their samplers by unit.
   */
  constructor(
    readonly gl: WebGL2RenderingContext,
    readonly entries: readonly GpuBindGroupEntry[],
    private readonly uniformBuffers: readonly { binding: number; buffer: WebGl2Buffer }[],
    private readonly textureUnits: readonly WebGl2TextureUnit[],
  ) {}

  /** Binds every resource for the following draws. */
  bind(): void {
    const { gl } = this;
    for (const { binding, buffer } of this.uniformBuffers) {
      gl.bindBufferBase(gl.UNIFORM_BUFFER, binding, buffer.handle);
    }
    for (const { unit, texture, sampler } of this.textureUnits) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture.handle);
      gl.bindSampler(unit, sampler?.handle ?? null);
    }
  }
}

/**
 * Texel formats: `rgba8unorm` for images and MSDF atlas pages, `r8unorm` for single-channel
 * masks and SDF atlases, and unfiltered `rgba32float` for exact placement tables. The unorm formats sample as floats in [0, 1]; `r8unorm` reads as `(r, 0, 0, 1)`.
 */
export type GpuTextureFormat = 'rgba8unorm' | 'r8unorm' | 'rgba32float';

/** How to create a {@link GpuTexture}: a single-level 2D texture that shaders sample. */
export interface GpuTextureDescriptor {
  /** The texel format. */
  readonly format: GpuTextureFormat;
  /** Width in texels, at most `GpuCapabilities.maxTextureSize`. */
  readonly width: number;
  /** Height in texels, at most `GpuCapabilities.maxTextureSize`. */
  readonly height: number;
  /** A name shown by GPU debuggers. */
  readonly label?: string;
}

/** A sampled 2D texture. Its texels are written with `GpuBackend.writeTexture`. */
export interface GpuTexture {
  /** The texel format. */
  readonly format: GpuTextureFormat;
  /** Width in texels. */
  readonly width: number;
  /** Height in texels. */
  readonly height: number;
  /** Frees the GPU memory. The handle must not be used afterwards. */
  destroy(): void;
}

/** A rectangle of texels; row 0 is the top row, which shaders sample at `v = 0`. */
export interface GpuTextureRegion {
  /** Left edge, in texels. */
  readonly x: number;
  /** Top edge, in texels. */
  readonly y: number;
  /** Width, in texels. */
  readonly width: number;
  /** Height, in texels. */
  readonly height: number;
}

/**
 * Where a region's texels sit in the source bytes. The defaults describe tightly packed rows
 * starting at byte 0; a larger `bytesPerRow` uploads a dirty region straight out of a whole
 * atlas page's pixels, as the prototype's `TextRenderer.syncPage` did.
 */
export interface GpuTextureDataLayout {
  /** Byte offset of the region's top-left texel in the source. Default 0. */
  readonly byteOffset?: number;
  /** Bytes from one source row to the next; a multiple of the texel size. Default: packed. */
  readonly bytesPerRow?: number;
}

/** Texel filtering when sampling between texel centres. */
export type GpuFilterMode = 'nearest' | 'linear';

/** What sampling outside [0, 1] reads. */
export type GpuAddressMode = 'clamp-to-edge' | 'repeat';

/** How to create a {@link GpuSampler}. */
export interface GpuSamplerDescriptor {
  /** Filtering for both magnification and minification. */
  readonly filter: GpuFilterMode;
  /** Wrapping in both directions. */
  readonly addressMode: GpuAddressMode;
  /** A name shown by GPU debuggers. */
  readonly label?: string;
}

/** Sampling state, bound beside a texture (WebGPU sampler; a WebGL2 sampler object). */
export interface GpuSampler {
  /** Filtering for both magnification and minification. */
  readonly filter: GpuFilterMode;
  /** Wrapping in both directions. */
  readonly addressMode: GpuAddressMode;
  /**
   * Frees the WebGL2 sampler object; WebGPU samplers are released by garbage collection. The
   * handle must not be used afterwards.
   */
  destroy(): void;
}

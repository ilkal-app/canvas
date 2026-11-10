import type { GpuBackendName } from './gpu-capabilities.js';
import type { GpuTexture } from './gpu-texture.js';

/** How to create a {@link GpuRenderTarget}: its size in device pixels. */
export interface GpuRenderTargetDescriptor {
  /** Width in device pixels, from 1 to `GpuCapabilities.maxTextureSize`. */
  readonly width: number;
  /** Height in device pixels, from 1 to `GpuCapabilities.maxTextureSize`. */
  readonly height: number;
}

/**
 * An offscreen colour target (layer opacity): passes begun with it as
 * `GpuRenderPassDescriptor.target` draw with the same pipelines as canvas passes (the canvas's
 * colour format and sample count, with a stencil), and resolve into `texture` when the pass ends.
 * The texture then samples as premultiplied `rgba8unorm`. Its rows run top to bottom on WebGPU
 * and bottom to top on WebGL2 (GL counts framebuffer rows from the bottom), so a shader that
 * samples it flips `v` on WebGL2 (the layer composite does).
 */
export interface GpuRenderTarget {
  /** Width in device pixels. */
  readonly width: number;
  /** Height in device pixels. */
  readonly height: number;
  /** The resolved colour, bound like any `texture` entry once a pass to the target has ended. */
  readonly texture: GpuTexture;
  /** Frees the resolved colour; later calls do nothing. Its handle must not be used afterwards. */
  destroy(): void;
}

/** Bytes per resolved texel: RGBA, 8 bits each. */
const RESOLVED_BYTES_PER_TEXEL = 4;

/**
 * Checks a render target's size against the device: whole pixels, at least 1 and at most the
 * largest texture edge. Pure.
 *
 * @param descriptor - The requested size.
 * @param maxTextureSize - `GpuCapabilities.maxTextureSize`.
 * @throws {RangeError} When either edge is not a whole number in [1, maxTextureSize].
 */
export function assertRenderTargetSize(
  descriptor: GpuRenderTargetDescriptor,
  maxTextureSize: number,
): void {
  for (const edge of [descriptor.width, descriptor.height]) {
    if (!Number.isSafeInteger(edge) || edge < 1 || edge > maxTextureSize) {
      throw new RangeError(
        `A render target edge is a whole number of pixels in [1, ${String(maxTextureSize)}]; received ${String(edge)}.`,
      );
    }
  }
}

/**
 * The bytes a target's resolved colour holds: what its owner reports under the `layers`
 * category of the memory ledger. The backend's shared scratch is not included. Pure.
 *
 * @param size - The target's size in device pixels.
 * @param size.width - Width in device pixels.
 * @param size.height - Height in device pixels.
 * @returns `width × height × 4`.
 */
export function renderTargetByteLength(size: {
  readonly width: number;
  readonly height: number;
}): number {
  return size.width * size.height * RESOLVED_BYTES_PER_TEXEL;
}

/**
 * Whether a backend's render targets store their rows bottom to top: true on WebGL2, whose
 * framebuffers count rows from the bottom, so sampling a target there flips `v`. Pure.
 *
 * @param backendName - `GpuCapabilities.backendName`.
 * @returns True for `webgl2`.
 */
export function isRenderTargetBottomUp(backendName: GpuBackendName): boolean {
  return backendName === 'webgl2';
}

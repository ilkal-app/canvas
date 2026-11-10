import type { GpuBindGroup, GpuBindGroupDescriptor } from './gpu-bind-group.js';
import type { GpuBuffer, GpuBufferDescriptor } from './gpu-buffer.js';
import type { GpuCapabilities } from './gpu-capabilities.js';
import type { GpuDrawStateCounts } from './gpu-draw-state-counts.js';
import type { GpuRenderPipeline, GpuRenderPipelineDescriptor } from './gpu-pipeline.js';
import type { GpuRenderPass, GpuRenderPassDescriptor } from './gpu-render-pass.js';
import type { GpuRenderTarget, GpuRenderTargetDescriptor } from './gpu-render-target.js';
import type {
  GpuSampler,
  GpuSamplerDescriptor,
  GpuTexture,
  GpuTextureDataLayout,
  GpuTextureDescriptor,
  GpuTextureRegion,
} from './gpu-texture.js';

/** The GPU time one labelled pass took. */
export interface GpuPassTiming {
  /** The pass's `timingLabel`. */
  readonly label: string;
  /** GPU time from the pass's start to its end, in milliseconds. */
  readonly durationMs: number;
}

/**
 * A lost GPU device or context (on a device lost the texture manager drops
 * to lower levels everywhere and rebuilds): every buffer, texture and pipeline of the backend
 * is gone, and a new backend must be created for the same canvas once `restored` settles.
 */
export interface GpuDeviceLoss {
  /** What the browser said, for the log. */
  readonly message: string;
  /**
   * Settles when the canvas can take a new backend: at once on WebGPU (a new device can be
   * requested straight away), at `webglcontextrestored` on WebGL2.
   */
  readonly restored: Promise<void>;
}

/**
 * Called once when a backend's device or context is lost.
 *
 * @param loss - What was lost and when a new backend can be made.
 */
export type GpuDeviceLostListener = (loss: GpuDeviceLoss) => void;

/**
 * The one interface every renderer is written against, with a WebGPU and a WebGL2
 * implementation. Create one with `createGpuBackend`.
 *
 * A frame is: write changed buffer ranges and texture regions, begin passes and draw, then
 * `submit()`. Commands take effect in call order on both backends, so a write made between two
 * passes is seen by the second pass only. Writes are rejected while a pass is open, on both
 * backends: per-draw values (the prototype's per-path colour and offset uniforms) belong in
 * per-instance attributes selected with `firstInstance`, or in one bind group per draw whose
 * uniform buffer was written before the pass. The backend renders into its canvas at the canvas's
 * current `width × height`, in device pixels. It is used from one thread: the main thread, or
 * the worker that owns an `OffscreenCanvas`.
 */
export interface GpuBackend {
  /** What this backend can do; fixed for its lifetime. */
  readonly capabilities: GpuCapabilities;
  /** The draw state it has set so far; absent, the frame reports none. */
  readonly drawStateCounts?: Readonly<GpuDrawStateCounts>;
  /**
   * Allocates a buffer; its contents start as zeros.
   *
   * @param descriptor - The usage and size in bytes.
   * @returns The new buffer.
   */
  createBuffer(descriptor: GpuBufferDescriptor): GpuBuffer;
  /**
   * Copies bytes into a buffer range: the dirty-range update that lets most frames upload nothing.
   *
   * @param buffer - The destination.
   * @param byteOffset - Where the write starts, in bytes; a multiple of 4.
   * @param data - The bytes to write; their length is a multiple of 4.
   * @throws {Error} When a render pass is open.
   * @throws {RangeError} When the range is misaligned or overruns the buffer.
   */
  writeBuffer(buffer: GpuBuffer, byteOffset: number, data: ArrayBufferView<ArrayBuffer>): void;
  /**
   * Allocates a 2D texture; its texels start as zeros.
   *
   * @param descriptor - The format and size in texels.
   * @returns The new texture.
   */
  createTexture(descriptor: GpuTextureDescriptor): GpuTexture;
  /**
   * Copies texels into a texture, whole or a sub-region.
   *
   * @param texture - The destination.
   * @param data - The source bytes.
   * @param region - The texels to write; the whole texture when omitted.
   * @param layout - Where the region sits in `data`; packed rows from byte 0 when omitted.
   * @throws {Error} When a render pass is open.
   * @throws {RangeError} When the region leaves the texture or `data` is too short.
   */
  writeTexture(
    texture: GpuTexture,
    data: ArrayBufferView<ArrayBuffer>,
    region?: GpuTextureRegion,
    layout?: GpuTextureDataLayout,
  ): void;
  /**
   * Creates sampling state for textures.
   *
   * @param descriptor - Filtering and wrapping.
   * @returns The new sampler.
   */
  createSampler(descriptor: GpuSamplerDescriptor): GpuSampler;
  /**
   * Compiles a pipeline from WGSL (WebGPU) or its generated GLSL ES 3.0 (WebGL2).
   *
   * @param descriptor - Shaders, vertex layout, bindings, blending and stencil state.
   * @returns The new pipeline.
   */
  createRenderPipeline(descriptor: GpuRenderPipelineDescriptor): GpuRenderPipeline;
  /**
   * Groups resources for a pipeline's bindings.
   *
   * @param descriptor - The pipeline and one resource per binding.
   * @returns The new bind group.
   */
  createBindGroup(descriptor: GpuBindGroupDescriptor): GpuBindGroup;
  /**
   * Allocates an offscreen render target (layer opacity): a resolved `rgba8unorm`
   * texture that passes with `target` draw into, with the canvas's pipelines. The backend draws
   * every target pass through one shared multisampled colour and stencil scratch, sized to the
   * largest live target, and resolves it into the target's texture at the pass's end. Destroying
   * the backend, or losing its device, destroys its targets.
   *
   * @param descriptor - The size in device pixels.
   * @returns The new target.
   * @throws {RangeError} When an edge is not a whole number in [1, `maxTextureSize`].
   */
  createRenderTarget(descriptor: GpuRenderTargetDescriptor): GpuRenderTarget;
  /**
   * Begins recording draws into the canvas, or into `descriptor.target`. Only one pass is open
   * at a time.
   *
   * @param descriptor - Clearing, timing and the target.
   * @returns The open pass.
   */
  beginRenderPass(descriptor: GpuRenderPassDescriptor): GpuRenderPass;
  /** Sends the frame's recorded passes to the GPU. Call once per frame, with no pass open. */
  submit(): void;
  /**
   * Resolves once the GPU has finished every command submitted so far (input marks):
   * WebGPU's `onSubmittedWorkDone`, a polled fence on WebGL2. Optional; rejects when the device
   * is lost or the wait gives up.
   *
   * @returns Settles when the work is done.
   */
  whenSubmittedWorkDone?(): Promise<void>;
  /**
   * Reads the canvas's pixels as RGBA8, rows top to bottom, `width × height × 4` bytes. Call it
   * after `submit()` in the same task, before the browser presents the frame. Used by the
   * parity test, the golden scenes and PNG projections.
   *
   * @returns The pixels, premultiplied as they were written.
   */
  readPixels(): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * Resolves with the GPU times of the labelled passes submitted since the previous call, once
   * the GPU has finished them; resolves to an empty list when timestamps are unsupported.
   *
   * @returns One timing per labelled pass, in submission order.
   */
  collectPassTimings(): Promise<readonly GpuPassTiming[]>;
  /**
   * Listens for the loss of the device (WebGPU `device.lost`) or context (WebGL2
   * `webglcontextlost`): the GPU was reset, the driver crashed or the browser reclaimed memory.
   * Called at most once, and never for the backend's own `destroy()`. After a loss every call
   * does nothing or returns a dead handle; the owner builds a new backend
   * (`EngineRuntime` does).
   *
   * @param listener - Called with the loss.
   * @returns Stops listening.
   */
  onDeviceLost(listener: GpuDeviceLostListener): () => void;
  /**
   * Loses the device as an outside cause would, for browser tests of recovery:
   * WebGPU destroys its device without silencing `onDeviceLost`; WebGL2 loses its context through
   * `WEBGL_lose_context` where the browser has it. Absent on backends that cannot.
   */
  loseDeviceForTesting?(): void;
  /**
   * Frees every GPU object the backend created, including buffers, textures, samplers and
   * pipelines the caller did not destroy. The backend and its handles must not be used afterwards.
   */
  destroy(): void;
}

import type { GpuSampleCount } from '../gpu-capabilities.js';
import type { GpuColor } from '../gpu-render-pass.js';
import { assertRenderTargetSize } from '../gpu-render-target.js';
import type { GpuRenderTarget, GpuRenderTargetDescriptor } from '../gpu-render-target.js';
import { RenderTargetExtent, isScratchStale } from '../render-target-extent.js';

import { STENCIL_FORMAT } from './webgpu-pipeline.js';
import { WebGpuTexture } from './webgpu-resources.js';

/** The scratch every target pass draws into, sized to the largest live target. */
interface WebGpuTargetScratch {
  readonly size: GpuRenderTargetDescriptor;
  /** Where colour is drawn: multisampled when the canvas is. */
  readonly color: GPUTexture;
  /** The single-sample colour the multisampled one resolves into; absent without MSAA. */
  readonly resolved: GPUTexture | undefined;
  readonly stencil: GPUTexture;
}

/** A target pass's attachments, and the copy that lands its colour in the target. */
export interface WebGpuTargetPass {
  /** The pass's attachments: cleared, with discarded multisampled colour and stencil. */
  readonly descriptor: GPURenderPassDescriptor;
  /**
   * Records the copy of the pass's resolved colour into the target's texture; called on the
   * command encoder once the pass has ended.
   */
  readonly land: (encoder: GPUCommandEncoder) => void;
}

/**
 * A WebGPU render target: a single-sample texture in the canvas's colour format,
 * which samples as `rgba8unorm` (a `bgra8unorm` canvas format reads back as RGBA in shaders).
 */
export class WebGpuRenderTarget implements GpuRenderTarget {
  /** The resolved colour. */
  readonly texture: WebGpuTexture;
  private isDestroyedFlag = false;

  /**
   * Wraps a created texture.
   *
   * @param device - The owning device.
   * @param handle - The target's texture.
   * @param onDestroy - Called once when the target is destroyed or dropped.
   */
  constructor(
    readonly device: GPUDevice,
    handle: GPUTexture,
    private readonly onDestroy: (target: WebGpuRenderTarget) => void,
  ) {
    this.texture = new WebGpuTexture(device, handle, 'rgba8unorm');
  }

  /**
   * Width in device pixels.
   *
   * @returns The texture's width.
   */
  get width(): number {
    return this.texture.width;
  }

  /**
   * Height in device pixels.
   *
   * @returns The texture's height.
   */
  get height(): number {
    return this.texture.height;
  }

  /**
   * Whether the target was destroyed, or dropped with its device.
   *
   * @returns True once destroyed.
   */
  get isDestroyed(): boolean {
    return this.isDestroyedFlag;
  }

  /** Frees the texture; later calls do nothing. */
  destroy(): void {
    if (this.isDestroyedFlag) return;
    this.isDestroyedFlag = true;
    this.texture.destroy();
    this.onDestroy(this);
  }
}

/**
 * The render targets of one WebGPU backend and their shared scratch. WebGPU needs a
 * pass's attachments and resolve target to be the same size, so a target pass draws into the
 * top-left corner of one scratch sized to the largest live target (multisampled colour and
 * `stencil8`, both stored with `discard`), resolves into a single-sample scratch of that size,
 * and copies the target's part into its texture. The scratch is reallocated when the largest
 * live target changes and freed with the last one.
 */
export class WebGpuRenderTargets {
  private readonly extent = new RenderTargetExtent();
  private readonly live = new Set<WebGpuRenderTarget>();
  private scratch: WebGpuTargetScratch | undefined;
  /** Scratch textures replaced since the last submit, which recorded commands may still use. */
  private readonly retired: GPUTexture[] = [];

  /**
   * Creates an empty set for a device.
   *
   * @param device - The device.
   * @param colorFormat - The canvas colour format, which pipelines are compiled for.
   * @param sampleCount - The canvas's samples per pixel, which pipelines are compiled for.
   */
  constructor(
    private readonly device: GPUDevice,
    private readonly colorFormat: GPUTextureFormat,
    private readonly sampleCount: GpuSampleCount,
  ) {}

  /**
   * How many targets are live.
   *
   * @returns The count.
   */
  get liveCount(): number {
    return this.live.size;
  }

  /**
   * The scratch's size.
   *
   * @returns Its size, or `undefined` when none is allocated.
   */
  get scratchSize(): GpuRenderTargetDescriptor | undefined {
    return this.scratch?.size;
  }

  /**
   * Allocates a target.
   *
   * @param descriptor - Its size.
   * @param maxTextureSize - The device's largest texture edge.
   * @returns The target.
   * @throws {RangeError} When the size is out of range.
   */
  create(descriptor: GpuRenderTargetDescriptor, maxTextureSize: number): WebGpuRenderTarget {
    assertRenderTargetSize(descriptor, maxTextureSize);
    const handle = this.device.createTexture({
      label: 'render target',
      size: { width: descriptor.width, height: descriptor.height },
      format: this.colorFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const target = new WebGpuRenderTarget(this.device, handle, (destroyed) => {
      this.forget(destroyed);
    });
    this.live.add(target);
    this.extent.add(target, descriptor);
    return target;
  }

  /**
   * The attachments of a pass to `target`, reallocating the scratch when the largest live
   * target changed.
   *
   * @param target - A live target of this set.
   * @param clearColor - The colour the pass starts from.
   * @returns The pass descriptor and the copy that lands its colour.
   * @throws {Error} When the target is destroyed or belongs to another backend.
   */
  beginPass(target: GpuRenderTarget, clearColor: GpuColor): WebGpuTargetPass {
    if (!(target instanceof WebGpuRenderTarget) || !this.live.has(target)) {
      throw new Error('A render pass target must be a live target of the same backend.');
    }
    const { width, height } = target;
    const scratch = this.currentScratch({ width, height });
    const source = scratch.resolved ?? scratch.color;
    return {
      descriptor: {
        colorAttachments: [
          {
            view: scratch.color.createView(),
            ...(scratch.resolved ? { resolveTarget: scratch.resolved.createView() } : {}),
            loadOp: 'clear',
            // Without MSAA the colour is the copy's source, so it is kept.
            storeOp: scratch.resolved ? 'discard' : 'store',
            clearValue: clearColor,
          },
        ],
        depthStencilAttachment: {
          view: scratch.stencil.createView(),
          stencilLoadOp: 'clear',
          stencilStoreOp: 'discard',
          stencilClearValue: 0,
        },
      },
      land: (encoder) => {
        encoder.copyTextureToTexture(
          { texture: source },
          { texture: target.texture.handle },
          { width, height },
        );
      },
    };
  }

  /**
   * Frees the scratch textures replaced before the frame's commands were submitted; the backend
   * calls it after each submit.
   */
  afterSubmit(): void {
    for (const texture of this.retired.splice(0)) texture.destroy();
  }

  /** Destroys every target and the scratch: on a device loss, and with the backend. */
  destroyAll(): void {
    for (const target of [...this.live]) target.destroy();
    this.afterSubmit();
  }

  private forget(target: WebGpuRenderTarget): void {
    this.live.delete(target);
    this.extent.delete(target);
    if (this.extent.liveCount === 0) this.freeScratch();
  }

  private currentScratch(minimum: GpuRenderTargetDescriptor): WebGpuTargetScratch {
    const required = this.extent.required(minimum);
    if (this.scratch !== undefined && !isScratchStale(this.scratch.size, required)) {
      return this.scratch;
    }
    this.freeScratch();
    const size = { width: required.width, height: required.height };
    const isMultisampled = this.sampleCount > 1;
    const scratch: WebGpuTargetScratch = {
      size: required,
      color: this.device.createTexture({
        label: 'render target scratch colour',
        size,
        format: this.colorFormat,
        sampleCount: this.sampleCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | (isMultisampled ? 0 : GPUTextureUsage.COPY_SRC),
      }),
      resolved: isMultisampled
        ? this.device.createTexture({
            label: 'render target scratch resolve',
            size,
            format: this.colorFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
          })
        : undefined,
      stencil: this.device.createTexture({
        label: 'render target scratch stencil',
        size,
        format: STENCIL_FORMAT,
        sampleCount: this.sampleCount,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      }),
    };
    this.scratch = scratch;
    return scratch;
  }

  private freeScratch(): void {
    const { scratch } = this;
    if (scratch === undefined) return;
    this.scratch = undefined;
    // Commands recorded but not yet submitted may still draw into it.
    this.retired.push(scratch.color, scratch.stencil);
    if (scratch.resolved) this.retired.push(scratch.resolved);
  }
}

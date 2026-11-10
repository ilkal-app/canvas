import type { GpuRenderTarget, GpuRenderTargetDescriptor } from '../gpu-render-target.js';
import { assertRenderTargetSize } from '../gpu-render-target.js';
import { RenderTargetExtent, isScratchStale } from '../render-target-extent.js';
import type { ResourceTracker } from '../resource-tracker.js';

import { WebGl2Texture } from './webgl2-resources.js';

/** The framebuffer every target pass draws into, sized to the largest live target. */
interface WebGl2TargetScratch {
  readonly size: GpuRenderTargetDescriptor;
  readonly framebuffer: WebGLFramebuffer;
  /** Multisampled `RGBA8` when the canvas is multisampled. */
  readonly color: WebGLRenderbuffer;
  /** `DEPTH24_STENCIL8`, with the colour's samples. */
  readonly stencil: WebGLRenderbuffer;
}

/** A bound target pass: what the backend needs to run and end it. */
export interface WebGl2TargetPass {
  /** The target's height in device pixels, which GL viewports are flipped against. */
  readonly height: number;
  /** Resolves the target's corner of the scratch into its texture with `blitFramebuffer`. */
  readonly resolve: () => void;
}

/**
 * A WebGL2 render target: an `RGBA8` texture with its own framebuffer, the
 * destination of the `blitFramebuffer` that resolves the scratch. Its rows run bottom to top.
 */
export class WebGl2RenderTarget implements GpuRenderTarget {
  /** The resolved colour. */
  readonly texture: WebGl2Texture;
  private isDestroyedFlag = false;

  /**
   * Wraps a created texture and its framebuffer.
   *
   * @param gl - The owning context.
   * @param texture - The resolved colour.
   * @param framebuffer - A framebuffer with `texture` as its colour attachment.
   * @param onDestroy - Called once when the target is destroyed.
   */
  constructor(
    readonly gl: WebGL2RenderingContext,
    texture: WebGl2Texture,
    readonly framebuffer: WebGLFramebuffer,
    private readonly onDestroy: (target: WebGl2RenderTarget) => void,
  ) {
    this.texture = texture;
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
   * Whether the target was destroyed, or dropped with its context.
   *
   * @returns True once destroyed.
   */
  get isDestroyed(): boolean {
    return this.isDestroyedFlag;
  }

  /** Frees the texture and framebuffer; later calls do nothing. */
  destroy(): void {
    if (this.isDestroyedFlag) return;
    this.isDestroyedFlag = true;
    this.gl.deleteFramebuffer(this.framebuffer);
    this.texture.destroy();
    this.onDestroy(this);
  }
}

/**
 * The render targets of one WebGL2 backend and their shared scratch: one framebuffer
 * with a multisampled `RGBA8` colour and a `DEPTH24_STENCIL8` renderbuffer, sized to the largest
 * live target. A target pass draws into the scratch's bottom-left corner (GL counts rows from
 * the bottom) and `blitFramebuffer` resolves that corner into the target's texture, after which
 * the scratch is invalidated. The scratch is reallocated when the largest live target changes and
 * freed with the last one; destroying the backend or losing the context destroys every target.
 */
export class WebGl2RenderTargets {
  private readonly extent = new RenderTargetExtent();
  private readonly live = new Set<WebGl2RenderTarget>();
  private scratch: WebGl2TargetScratch | undefined;
  private readonly samples: number;

  /**
   * Creates an empty set for a context.
   *
   * @param gl - The context.
   * @param sampleCount - The canvas's samples per pixel; the scratch matches it.
   * @param tracker - The backend's live resources; each target adds itself, so the backend's
   *   `destroy()` frees it.
   */
  constructor(
    private readonly gl: WebGL2RenderingContext,
    sampleCount: number,
    private readonly tracker: ResourceTracker,
  ) {
    // 0 samples is a single-sample renderbuffer; the blit then copies instead of resolving.
    this.samples = sampleCount > 1 ? sampleCount : 0;
  }

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
   * Allocates a target: an immutable `RGBA8` texture and a framebuffer around it.
   *
   * @param descriptor - Its size.
   * @param maxTextureSize - The context's largest texture edge.
   * @returns The target.
   * @throws {RangeError} When the size is out of range.
   */
  create(descriptor: GpuRenderTargetDescriptor, maxTextureSize: number): WebGl2RenderTarget {
    assertRenderTargetSize(descriptor, maxTextureSize);
    const { gl } = this;
    const { width, height } = descriptor;
    const texture = new WebGl2Texture(
      gl,
      gl.createTexture(),
      'rgba8unorm',
      width,
      height,
      this.tracker,
    );
    gl.bindTexture(gl.TEXTURE_2D, texture.handle);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.handle, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const target = new WebGl2RenderTarget(gl, texture, framebuffer, (destroyed) => {
      this.forget(destroyed);
    });
    this.live.add(target);
    this.extent.add(target, descriptor);
    this.tracker.track(target);
    return target;
  }

  /**
   * Binds the scratch for a pass to `target`, reallocating it when the largest live target
   * changed, and sets the viewport to the target's corner. The caller clears.
   *
   * @param target - A live target of this set.
   * @returns The target's height, which GL viewports are flipped against, and the resolve to
   *   call when the pass ends.
   * @throws {Error} When the target is destroyed or belongs to another backend.
   */
  bind(target: GpuRenderTarget): WebGl2TargetPass {
    if (!(target instanceof WebGl2RenderTarget) || !this.live.has(target)) {
      throw new Error('A render pass target must be a live target of the same backend.');
    }
    const { gl } = this;
    const { width, height } = target;
    const scratch = this.currentScratch({ width, height });
    gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.framebuffer);
    gl.viewport(0, 0, width, height);
    return {
      height,
      resolve: () => {
        // Blit the target's corner into its texture, discard the scratch, rebind the canvas.
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, scratch.framebuffer);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer);
        // A pipeline may have narrowed the colour mask; the blit writes every channel.
        gl.colorMask(true, true, true, true);
        gl.blitFramebuffer(
          0,
          0,
          width,
          height,
          0,
          0,
          width,
          height,
          gl.COLOR_BUFFER_BIT,
          gl.NEAREST,
        );
        gl.invalidateFramebuffer(gl.READ_FRAMEBUFFER, [
          gl.COLOR_ATTACHMENT0,
          gl.DEPTH_STENCIL_ATTACHMENT,
        ]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      },
    };
  }

  /** Destroys every target and the scratch: on a context loss, and with the backend. */
  destroyAll(): void {
    for (const target of [...this.live]) target.destroy();
  }

  private forget(target: WebGl2RenderTarget): void {
    this.live.delete(target);
    this.extent.delete(target);
    this.tracker.untrack(target);
    if (this.extent.liveCount === 0) this.freeScratch();
  }

  private currentScratch(minimum: GpuRenderTargetDescriptor): WebGl2TargetScratch {
    const required = this.extent.required(minimum);
    if (this.scratch !== undefined && !isScratchStale(this.scratch.size, required)) {
      return this.scratch;
    }
    this.freeScratch();
    const { gl, samples } = this;
    const { width, height } = required;
    const color = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height);
    const stencil = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, stencil);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, width, height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_STENCIL_ATTACHMENT,
      gl.RENDERBUFFER,
      stencil,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.scratch = { size: required, framebuffer, color, stencil };
    return this.scratch;
  }

  private freeScratch(): void {
    const { gl, scratch } = this;
    if (scratch === undefined) return;
    this.scratch = undefined;
    gl.deleteFramebuffer(scratch.framebuffer);
    gl.deleteRenderbuffer(scratch.color);
    gl.deleteRenderbuffer(scratch.stencil);
  }
}

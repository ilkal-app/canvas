import type { GpuBindGroup } from './gpu-bind-group.js';
import type { GpuBuffer } from './gpu-buffer.js';
import type { GpuRenderPipeline } from './gpu-pipeline.js';
import type { GpuRenderTarget } from './gpu-render-target.js';

/** A colour as `[red, green, blue, alpha]`, each in [0, 1], premultiplied by alpha. */
export type GpuColor = readonly [number, number, number, number];

/** A rectangle of the canvas, in device pixels, origin at the top-left corner. */
export interface GpuViewport {
  /** Left edge, in device pixels. */
  readonly x: number;
  /** Top edge, in device pixels. */
  readonly y: number;
  /** Width, in device pixels. */
  readonly width: number;
  /** Height, in device pixels. */
  readonly height: number;
}

/** How to begin a {@link GpuRenderPass} on the canvas or on a render target. */
export interface GpuRenderPassDescriptor {
  /**
   * The colour to clear to; the stencil is cleared to 0 with it. Absent means the pass draws
   * over what earlier passes of the frame left (the first pass of a frame should clear). A pass
   * to a `target` always clears, to this colour or to transparent.
   */
  readonly clearColor?: GpuColor;
  /**
   * Draw into this render target of the same backend instead of the canvas. The pass
   * starts cleared, its viewport is the target's whole size, and its colour resolves into
   * `target.texture` when it ends, which also submits the work recorded so far (so resources the
   * pass drew with may be destroyed after `end()`); nothing of an earlier pass is loaded.
   */
  readonly target?: GpuRenderTarget;
  /**
   * Measure this pass's GPU time under this label; read it with `collectPassTimings`. Ignored
   * when `GpuCapabilities.hasTimestampQuery` is false.
   */
  readonly timingLabel?: string;
}

/**
 * Records draws into the canvas or a render target. Commands take effect in call order on both
 * backends. The viewport starts as the whole canvas (or target); nothing is bound until set.
 */
export interface GpuRenderPass {
  /**
   * Limits drawing to a rectangle of the canvas; clip space maps onto it.
   *
   * @param viewport - The rectangle, in device pixels from the top-left corner.
   */
  setViewport(viewport: GpuViewport): void;
  /**
   * Selects the shaders and fixed-function state for the following draws.
   *
   * @param pipeline - A pipeline created by the same backend.
   */
  setPipeline(pipeline: GpuRenderPipeline): void;
  /**
   * Binds group 0's resources for the following draws.
   *
   * @param bindGroup - A bind group created by the same backend.
   */
  setBindGroup(bindGroup: GpuBindGroup): void;
  /**
   * Binds a vertex buffer to a slot of the current pipeline's vertex layout.
   *
   * @param slot - The index into the pipeline's `vertexBuffers`.
   * @param buffer - A `vertex` buffer created by the same backend.
   * @param byteOffset - Where record 0 starts in the buffer, in bytes. Default 0.
   */
  setVertexBuffer(slot: number, buffer: GpuBuffer, byteOffset?: number): void;
  /**
   * Draws triangle lists: `instanceCount` instances of vertices
   * `[firstVertex, firstVertex + vertexCount)`, starting at instance record `firstInstance`.
   * An instance range is how z-order segments draw part of a persistent instance buffer
   * (the prototype's `drawInstanceRange`).
   *
   * @param vertexCount - Vertices per instance, a multiple of 3.
   * @param instanceCount - Instances to draw. Default 1.
   * @param firstVertex - The first vertex record. Default 0.
   * @param firstInstance - The first instance record. Default 0.
   */
  draw(
    vertexCount: number,
    instanceCount?: number,
    firstVertex?: number,
    firstInstance?: number,
  ): void;
  /** Finishes the pass. Another pass may begin, or the frame may be submitted, only after this. */
  end(): void;
}

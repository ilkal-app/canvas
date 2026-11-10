import type { GpuBindGroup } from '../gpu-bind-group.js';
import type { GpuBuffer } from '../gpu-buffer.js';
import { newDrawStateCounts, type GpuDrawStateCounts } from '../gpu-draw-state-counts.js';
import type { GpuRenderPipeline } from '../gpu-pipeline.js';
import type { GpuRenderPass, GpuViewport } from '../gpu-render-pass.js';

import { firstRecordByteOffset } from './instance-range.js';
import { WebGl2Pipeline } from './webgl2-pipeline.js';
import { WebGl2BindGroup, WebGl2Buffer, claimWebGl2 } from './webgl2-resources.js';

interface BoundVertexBuffer {
  readonly buffer: WebGl2Buffer;
  readonly byteOffset: number;
}

/**
 * A render pass on the WebGL2 default framebuffer. GL has no pass object, so this records
 * nothing: each call changes GL state or draws immediately, which is the call order WebGPU
 * also guarantees.
 */
export class WebGl2RenderPass implements GpuRenderPass {
  private pipeline: WebGl2Pipeline | undefined;
  private readonly vertexBuffers: (BoundVertexBuffer | undefined)[] = [];
  private isEnded = false;

  /**
   * Opens the pass; the caller has cleared and set the full-canvas viewport.
   *
   * @param gl - The context.
   * @param framebufferHeight - The drawing buffer height in device pixels, to flip viewports.
   * @param onEnd - Called once when the pass ends.
   * @param counts - The backend's draw-state counts, added to as state is applied.
   */
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly framebufferHeight: number,
    private readonly onEnd: () => void,
    private readonly counts: GpuDrawStateCounts = newDrawStateCounts(),
  ) {}

  /**
   * GL counts viewport rows from the bottom; the interface counts from the top.
   *
   * @param viewport - The rectangle in device pixels from the top-left corner.
   */
  setViewport(viewport: GpuViewport): void {
    const { x, y, width, height } = viewport;
    this.gl.viewport(x, this.framebufferHeight - y - height, width, height);
  }

  /**
   * Applies the pipeline's program and fixed-function state.
   *
   * @param pipeline - A pipeline of this backend.
   */
  setPipeline(pipeline: GpuRenderPipeline): void {
    this.pipeline = claimWebGl2(pipeline, WebGl2Pipeline, this.gl);
    this.pipeline.apply();
    this.counts.pipelineSwitches += 1;
  }

  /**
   * Binds uniform buffers and texture units.
   *
   * @param bindGroup - A bind group of this backend.
   */
  setBindGroup(bindGroup: GpuBindGroup): void {
    claimWebGl2(bindGroup, WebGl2BindGroup, this.gl).bind();
    this.counts.bindGroupChanges += 1;
  }

  /**
   * Remembers a vertex buffer; attribute pointers are aimed at draw time.
   *
   * @param slot - The pipeline's vertex buffer slot.
   * @param buffer - A vertex buffer of this backend.
   * @param byteOffset - Where record 0 starts, in bytes.
   */
  setVertexBuffer(slot: number, buffer: GpuBuffer, byteOffset = 0): void {
    this.vertexBuffers[slot] = { buffer: claimWebGl2(buffer, WebGl2Buffer, this.gl), byteOffset };
  }

  /**
   * Aims every attribute at the draw's first record, then draws instanced triangles.
   *
   * @param vertexCount - Vertices per instance.
   * @param instanceCount - Instances to draw.
   * @param firstVertex - The first vertex record.
   * @param firstInstance - The first instance record.
   * @throws {Error} When no pipeline is set or a slot has no buffer.
   */
  draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
    // Per-draw CPU cost (here, re-aiming every attribute pointer) is in the frame-time suite's
    // `draw` stage time (tooling/bench); `pnpm bench:ci --backend webgl2` measures this backend.
    // TODO: gate it in CI, whose benchmark job measures WebGPU only.
    const { gl, pipeline } = this;
    if (!pipeline) {
      throw new Error('setPipeline must be called before draw.');
    }
    gl.bindVertexArray(pipeline.vertexArray);
    pipeline.vertexBuffers.forEach((layout, slot) => {
      const bound = this.vertexBuffers[slot];
      if (!bound) {
        throw new Error(`Vertex buffer slot ${String(slot)} has no buffer.`);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, bound.buffer.handle);
      const start = firstRecordByteOffset(
        layout.stepMode,
        layout.byteStride,
        bound.byteOffset,
        firstInstance,
      );
      for (const attribute of layout.attributes) {
        const type = attribute.componentType === 'float32' ? gl.FLOAT : gl.UNSIGNED_BYTE;
        gl.vertexAttribPointer(
          attribute.location,
          attribute.componentCount,
          type,
          attribute.isNormalized,
          layout.byteStride,
          start + attribute.byteOffset,
        );
      }
    });
    gl.drawArraysInstanced(gl.TRIANGLES, firstVertex, vertexCount, instanceCount);
    gl.bindVertexArray(null);
  }

  /** Ends the pass. */
  end(): void {
    if (!this.isEnded) {
      this.isEnded = true;
      this.onEnd();
    }
  }
}

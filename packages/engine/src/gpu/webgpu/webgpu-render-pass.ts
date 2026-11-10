import type { GpuBindGroup } from '../gpu-bind-group.js';
import type { GpuBuffer } from '../gpu-buffer.js';
import { newDrawStateCounts, type GpuDrawStateCounts } from '../gpu-draw-state-counts.js';
import type { GpuRenderPipeline } from '../gpu-pipeline.js';
import type { GpuRenderPass, GpuViewport } from '../gpu-render-pass.js';

import { WebGpuPipeline } from './webgpu-pipeline.js';
import { WebGpuBindGroup, WebGpuBuffer, claimWebGpu } from './webgpu-resources.js';

// One check per kind, so each call site sees one class (the shared check was 3–13% of
// worker time in a zoomed-out frame).

function claimPipeline(pipeline: GpuRenderPipeline, device: GPUDevice): WebGpuPipeline {
  return pipeline instanceof WebGpuPipeline && pipeline.device === device
    ? pipeline
    : claimWebGpu(pipeline, WebGpuPipeline, device);
}

function claimBindGroup(bindGroup: GpuBindGroup, device: GPUDevice): WebGpuBindGroup {
  return bindGroup instanceof WebGpuBindGroup && bindGroup.device === device
    ? bindGroup
    : claimWebGpu(bindGroup, WebGpuBindGroup, device);
}

function claimBuffer(buffer: GpuBuffer, device: GPUDevice): WebGpuBuffer {
  return buffer instanceof WebGpuBuffer && buffer.device === device
    ? buffer
    : claimWebGpu(buffer, WebGpuBuffer, device);
}

/**
 * A WebGPU render pass encoder behind the backend interface. It passes on only state that
 * changes: a pipeline, bind group or vertex buffer already bound is not bound again,
 * and its handle is checked only when it is bound. WebGPU keeps bind groups and vertex buffers
 * bound across pipeline changes. The stencil reference is the one the bound pipeline's test
 * compares with: 0, the pass default, unless it sets another (the vector tier's edges).
 */
export class WebGpuRenderPass implements GpuRenderPass {
  private isEnded = false;
  private pipeline: GpuRenderPipeline | undefined;
  /** The stencil reference set on the pass: 0, the default, until a pipeline sets another. */
  private stencilReference = 0;
  private bindGroup: GpuBindGroup | undefined;
  /** Per vertex buffer slot, the buffer bound and its offset. */
  private readonly vertexBuffers: (GpuBuffer | undefined)[] = [];
  private readonly vertexOffsets: number[] = [];

  /**
   * Wraps an open pass encoder.
   *
   * @param device - The owning device, for handle checks.
   * @param encoder - The pass encoder.
   * @param onEnd - Called once when the pass ends.
   * @param counts - The backend's draw-state counts, added to as state is bound.
   */
  constructor(
    private readonly device: GPUDevice,
    private readonly encoder: GPURenderPassEncoder,
    private readonly onEnd: () => void,
    private readonly counts: GpuDrawStateCounts = newDrawStateCounts(),
  ) {}

  /**
   * Sets the viewport; WebGPU also counts from the top-left corner.
   *
   * @param viewport - The rectangle in device pixels.
   */
  setViewport(viewport: GpuViewport): void {
    this.encoder.setViewport(viewport.x, viewport.y, viewport.width, viewport.height, 0, 1);
  }

  /**
   * Selects a pipeline, unless it is the one selected, and the stencil reference its test
   * compares with when that differs from the pass's (0 at first).
   *
   * @param pipeline - A pipeline of this backend.
   */
  setPipeline(pipeline: GpuRenderPipeline): void {
    if (pipeline === this.pipeline) return;
    const claimed = claimPipeline(pipeline, this.device);
    this.encoder.setPipeline(claimed.handle);
    const reference = claimed.stencilReference ?? 0;
    if (reference !== this.stencilReference) {
      this.encoder.setStencilReference(reference);
      this.stencilReference = reference;
    }
    this.pipeline = pipeline;
    this.counts.pipelineSwitches += 1;
  }

  /**
   * Binds group 0, unless it is bound.
   *
   * @param bindGroup - A bind group of this backend.
   */
  setBindGroup(bindGroup: GpuBindGroup): void {
    if (bindGroup === this.bindGroup) return;
    this.encoder.setBindGroup(0, claimBindGroup(bindGroup, this.device).handle);
    this.bindGroup = bindGroup;
    this.counts.bindGroupChanges += 1;
  }

  /**
   * Binds a vertex buffer to a slot, unless it is bound there at the same offset.
   *
   * @param slot - The pipeline's vertex buffer slot.
   * @param buffer - A vertex buffer of this backend.
   * @param byteOffset - Where record 0 starts, in bytes.
   */
  setVertexBuffer(slot: number, buffer: GpuBuffer, byteOffset = 0): void {
    if (buffer === this.vertexBuffers[slot] && byteOffset === this.vertexOffsets[slot]) return;
    this.encoder.setVertexBuffer(slot, claimBuffer(buffer, this.device).handle, byteOffset);
    this.vertexBuffers[slot] = buffer;
    this.vertexOffsets[slot] = byteOffset;
  }

  /**
   * Draws instanced triangles; WebGPU supports a first instance natively.
   *
   * @param vertexCount - Vertices per instance.
   * @param instanceCount - Instances to draw.
   * @param firstVertex - The first vertex record.
   * @param firstInstance - The first instance record.
   */
  draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
    this.encoder.draw(vertexCount, instanceCount, firstVertex, firstInstance);
  }

  /** Ends the pass encoder. */
  end(): void {
    if (!this.isEnded) {
      this.isEnded = true;
      this.encoder.end();
      this.onEnd();
    }
  }
}

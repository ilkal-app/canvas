import type { GpuBuffer } from '../gpu/gpu-buffer.js';
import type { GpuRenderPipeline } from '../gpu/gpu-pipeline.js';
import type { GpuRenderPass } from '../gpu/gpu-render-pass.js';

import type { GpuPathMesh } from './gpu-path-mesh.js';
import type { PathLayer } from './path-layers.js';
import { COVER_VERTEX_COUNT } from './path-mesh.js';
import type { PathPipelines } from './path-pipelines.js';

/**
 * Draws path layers into an open render pass, one draw-list entry at a time, binding only what
 * changes between layers: the pipeline (five fixed-function states), the camera once, the
 * instance buffer once, and the shared mesh buffer when a mesh is in another one; each
 * mesh draws from its first vertex in it. Counts its draws.
 */
export class PathLayerDraws {
  /** Draw calls made so far. */
  draws = 0;
  private readonly renderPass: GpuRenderPass;
  private readonly pipelines: PathPipelines;
  private readonly instanceBuffer: GpuBuffer;
  private pipeline: GpuRenderPipeline | undefined;
  private meshBuffer: GpuBuffer | undefined;

  /**
   * Starts drawing an entry.
   *
   * @param renderPass - The open render pass.
   * @param pipelines - The path pass's pipelines and camera bind group.
   * @param instanceBuffer - The GPU copy of the pass's layer records.
   * @param moveIndices - Optional per-record retained placement indices.
   */
  constructor(
    renderPass: GpuRenderPass,
    pipelines: PathPipelines,
    instanceBuffer: GpuBuffer,
    private readonly moveIndices?: GpuBuffer,
  ) {
    this.renderPass = renderPass;
    this.pipelines = pipelines;
    this.instanceBuffer = instanceBuffer;
  }

  /**
   * Draws one layer of a path: a fill as its fans into the stencil and its cover quad; an opaque
   * stroke as its triangles; a translucent stroke as its triangles where the stencil is clear
   * (so overlapping triangles paint each pixel once) and the cover quad to clear it again.
   *
   * @param layer - The layer.
   * @param mesh - The path's mesh, with a buffer.
   * @param buffer - That buffer.
   * @param slot - The layer's record, which places the mesh and colours it.
   * @param isOpaque - Whether the layer's colour is opaque.
   */
  drawLayer(
    layer: PathLayer,
    mesh: GpuPathMesh,
    buffer: GpuBuffer,
    slot: number,
    isOpaque: boolean,
  ): void {
    if (this.meshBuffer === undefined) {
      this.renderPass.setVertexBuffer(1, this.instanceBuffer);
      if (this.moveIndices) this.renderPass.setVertexBuffer(2, this.moveIndices);
    }
    if (this.meshBuffer !== buffer) {
      this.renderPass.setVertexBuffer(0, buffer);
      this.meshBuffer = buffer;
    }
    const { fillVertexCount, strokeVertexCount, firstVertex } = mesh;
    const cover = firstVertex + fillVertexCount;
    const { pipelines } = this;
    if (layer === 'fill') {
      if (fillVertexCount === 0) return;
      this.draw(pipelines.fillStencil, fillVertexCount, firstVertex, slot);
      this.draw(pipelines.fillCover, COVER_VERTEX_COUNT, cover, slot);
      return;
    }
    if (strokeVertexCount === 0) return;
    const firstStrokeVertex = cover + COVER_VERTEX_COUNT;
    if (isOpaque) {
      this.draw(pipelines.stroke, strokeVertexCount, firstStrokeVertex, slot);
      return;
    }
    this.draw(pipelines.strokeOnce, strokeVertexCount, firstStrokeVertex, slot);
    this.draw(pipelines.stencilClear, COVER_VERTEX_COUNT, cover, slot);
  }

  private draw(
    pipeline: GpuRenderPipeline,
    vertexCount: number,
    firstVertex: number,
    slot: number,
  ): void {
    if (this.pipeline !== pipeline) {
      const isFirst = this.pipeline === undefined;
      this.renderPass.setPipeline(pipeline);
      if (isFirst) this.renderPass.setBindGroup(this.pipelines.bindGroup);
      this.pipeline = pipeline;
    }
    this.renderPass.draw(vertexCount, 1, firstVertex, slot);
    this.draws += 1;
  }
}

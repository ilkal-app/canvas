import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBindGroup, GpuBindGroupEntry } from '../gpu/gpu-bind-group.js';
import type { GpuBuffer } from '../gpu/gpu-buffer.js';
import type { GpuRenderPipeline } from '../gpu/gpu-pipeline.js';
import type { GpuRenderPass } from '../gpu/gpu-render-pass.js';
import { MOVE_INDEX_LAYOUT, type MovePlacementBinding } from '../gpu/move-placement.js';

import type { CameraUniform } from './camera-uniform.js';
import { CLIP_TABLE_BINDING, type ClipTableTexture } from './clip-table-texture.js';
import type { FrameStats } from './frame-context.js';
import type { InstanceRange } from './scene-culler.js';
import type { ScenePass } from './scene-pass.js';

/** A temporary absolute-placement pipeline, borrowing ordinary vertex and instance buffers. */
export class MoveInstancedDraw {
  private readonly pipeline: GpuRenderPipeline;
  private readonly groups = new Map<
    number,
    {
      readonly entries: readonly GpuBindGroupEntry[];
      readonly group: GpuBindGroup;
    }
  >();

  constructor(
    private readonly backend: GpuBackend,
    private readonly pass: ScenePass,
    private readonly shared: {
      readonly camera: CameraUniform;
      readonly clipTable: ClipTableTexture;
    },
    private readonly placement: MovePlacementBinding,
    private readonly vertices: GpuBuffer,
  ) {
    const { pipelineSpec: spec } = pass;
    if (!spec.moveShader) throw new Error('A retained move requires an explicit shader variant.');
    this.pipeline = backend.createRenderPipeline({
      shader: spec.moveShader,
      vertexBuffers: [spec.vertexLayout, pass.layout.vertexBufferLayout, MOVE_INDEX_LAYOUT],
      bindings: [
        { binding: 0, kind: 'uniform-buffer' },
        ...(spec.pageBindings ?? []),
        { binding: 4, kind: 'load-texture' },
        { binding: CLIP_TABLE_BINDING, kind: 'load-texture' },
      ],
      blend: spec.blend,
      label: `${pass.name} retained move`,
    });
  }

  /**
   * Draws the same ordered ranges with absolute placement instead of rewritten record origins.
   *
   * @param renderPass - The current GPU render pass.
   * @param ranges - The ordinary culler's ranges, unchanged.
   * @param stats - Frame counters.
   * @param page - The ordinary resource page.
   * @param instances - The current ordinary instance buffer.
   */
  draw(
    renderPass: GpuRenderPass,
    ranges: readonly InstanceRange[],
    stats: FrameStats,
    page: number,
    instances: GpuBuffer,
  ): void {
    if (!ranges.some((range) => range.count > 0)) return;
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(this.groupFor(page));
    renderPass.setVertexBuffer(0, this.vertices);
    renderPass.setVertexBuffer(1, instances);
    renderPass.setVertexBuffer(2, this.placement.indices);
    for (const { start, count } of ranges) {
      if (count <= 0) continue;
      renderPass.draw(this.pass.pipelineSpec.vertexCount, count, 0, start);
      stats.drawCalls++;
    }
  }

  /** Frees only the temporary pipeline; all bound buffers and textures are borrowed. */
  destroy(): void {
    this.pipeline.destroy();
    this.groups.clear();
  }

  private groupFor(page: number): GpuBindGroup {
    const entries: readonly GpuBindGroupEntry[] = [
      { binding: 0, buffer: this.shared.camera.buffer },
      ...(this.pass.pageEntries?.(page) ?? []),
      { binding: 4, texture: this.placement.table.texture },
      // Rebuilt when the clip table grows: the entries compare its texture by identity.
      { binding: CLIP_TABLE_BINDING, texture: this.shared.clipTable.texture },
    ];
    const cached = this.groups.get(page);
    if (
      entries.length === cached?.entries.length &&
      entries.every((entry, index) => {
        const other = cached.entries[index];
        if (other?.binding !== entry.binding) return false;
        if ('buffer' in entry) return 'buffer' in other && entry.buffer === other.buffer;
        if ('texture' in entry) return 'texture' in other && entry.texture === other.texture;
        return 'sampler' in other && entry.sampler === other.sampler;
      })
    )
      return cached.group;
    const group = this.backend.createBindGroup({ pipeline: this.pipeline, entries });
    this.groups.set(page, { entries, group });
    return group;
  }
}

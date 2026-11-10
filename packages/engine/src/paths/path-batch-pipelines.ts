// The batched opaque strokes' pipelines: path-batch.wgsl over a (x, y, record slot)
// vertex stream, with the path records, the clip table and the retained-move transforms as
// textures.
import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBindGroup } from '../gpu/gpu-bind-group.js';
import type { GpuBuffer } from '../gpu/gpu-buffer.js';
import type { GpuRenderPipeline } from '../gpu/gpu-pipeline.js';
import type { GpuTexture } from '../gpu/gpu-texture.js';
import { PATH_BATCH_SHADER } from '../gpu/shaders/path-batch.generated.js';
import type { GpuVertexBufferLayout } from '../gpu/vertex-layout.js';
import { CLIP_TABLE_BINDING, type ClipTableTexture } from '../scene/clip-table-texture.js';

/** A batched stroke vertex: its position in its path's frame, then its record slot. */
export const PATH_BATCH_VERTEX_LAYOUT: GpuVertexBufferLayout = {
  stepMode: 'vertex',
  attributes: [
    { location: 0, format: 'float32x2' },
    { location: 3, format: 'float32' },
  ],
};

/** Floats per batched vertex: x, y and the record slot. */
export const PATH_BATCH_VERTEX_FLOATS = 3;

/** The record texture's binding in path-batch.wgsl. */
const RECORD_BINDING = 6;

/** The retained-move table's binding, as in the move variants (scripts/move-shader.ts). */
const MOVE_BINDING = 4;

/** The pipelines and bind group of the batched opaque strokes. */
export class PathBatchPipelines {
  /** Opaque strokes, no stencil. */
  readonly stroke: GpuRenderPipeline;
  /** The same during a retained move (the record's move index picks the table's placement). */
  readonly moveStroke: GpuRenderPipeline;
  private readonly placeholder: GpuTexture;
  private bindGroup: GpuBindGroup | undefined;
  private bound: readonly GpuTexture[] = [];

  /**
   * Creates the pipelines.
   *
   * @param backend - The backend.
   * @param cameraBuffer - The camera uniform.
   * @param clipTable - The scene's clip table.
   * @param label - The pass's name, for GPU debuggers.
   */
  constructor(
    private readonly backend: GpuBackend,
    private readonly cameraBuffer: GpuBuffer,
    private readonly clipTable: ClipTableTexture,
    private readonly label: string,
  ) {
    const create = (name: string): GpuRenderPipeline =>
      backend.createRenderPipeline({
        shader: PATH_BATCH_SHADER,
        vertexBuffers: [PATH_BATCH_VERTEX_LAYOUT],
        bindings: [
          { binding: 0, kind: 'uniform-buffer' },
          { binding: MOVE_BINDING, kind: 'load-texture' },
          { binding: CLIP_TABLE_BINDING, kind: 'load-texture' },
          { binding: RECORD_BINDING, kind: 'load-texture' },
        ],
        blend: 'premultiplied',
        colorWrite: 'all',
        label: `${label} ${name}`,
      });
    this.stroke = create('batched stroke');
    this.moveStroke = create('batched move stroke');
    // No retained move: every record's move index is 0, so the table is never read.
    this.placeholder = backend.createTexture({
      format: 'rgba32float',
      width: 1,
      height: 1,
      label: `${label} batch move placeholder`,
    });
  }

  /**
   * The bind group for the current textures, rebuilt when one is replaced.
   *
   * @param records - The path record texture.
   * @param moveTable - The retained move's transform table, if one is active.
   * @returns The bind group.
   */
  bindGroupFor(records: GpuTexture, moveTable: GpuTexture | undefined): GpuBindGroup {
    const move = moveTable ?? this.placeholder;
    const textures = [records, move, this.clipTable.texture];
    if (this.bindGroup && textures.every((texture, index) => texture === this.bound[index])) {
      return this.bindGroup;
    }
    this.bound = textures;
    this.bindGroup = this.backend.createBindGroup({
      pipeline: this.stroke,
      entries: [
        { binding: 0, buffer: this.cameraBuffer },
        { binding: MOVE_BINDING, texture: move },
        { binding: CLIP_TABLE_BINDING, texture: this.clipTable.texture },
        { binding: RECORD_BINDING, texture: records },
      ],
      label: `${this.label} batch`,
    });
    return this.bindGroup;
  }

  /** Frees the pipelines and the placeholder. */
  destroy(): void {
    this.stroke.destroy();
    this.moveStroke.destroy();
    this.placeholder.destroy();
  }
}

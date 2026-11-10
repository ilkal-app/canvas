import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBindGroup } from '../gpu/gpu-bind-group.js';
import type { GpuBuffer } from '../gpu/gpu-buffer.js';
import type { GpuRenderPipeline } from '../gpu/gpu-pipeline.js';
import type { GpuRenderPass } from '../gpu/gpu-render-pass.js';
import { CLIP_TABLE_BINDING, ClipTableTexture } from '../scene/clip-table-texture.js';

import { SHAPE_CAMERA_BYTE_LENGTH } from './shape-camera.js';
import { packShapeInstances, SHAPE_INSTANCE_BYTES } from './shape-instance-layout.js';
import type { ShapeInstance } from './shape-instance.js';
import {
  SHAPE_BINDINGS,
  SHAPE_PIPELINE_DESCRIPTOR,
  SHAPE_QUAD_VERTEX_COUNT,
  SHAPE_UNCLIPPED_QUAD_VERTICES,
} from './shape-pipeline.js';

/** A run of consecutive records in a shape instance buffer, such as one z-order segment's. */
export interface ShapeInstanceRange {
  /** The first record drawn; a non-negative integer. */
  readonly first: number;
  /** How many records are drawn; a non-negative integer. */
  readonly count: number;
}

function assertWholeCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `A shape range's ${name} must be a non-negative integer; received ${String(value)}.`,
    );
  }
}

/**
 * Draws SDF shapes (rounded boxes and ellipses with optional soft edges)
 * through a {@link GpuBackend}: one pipeline, one unit-quad vertex buffer, and caller-owned
 * persistent instance buffers drawn by record range. Ported from the prototype's
 * `src/render/shapeRenderer.ts`. Used from the thread that owns the backend.
 */
export class ShapeRenderer {
  /** The compiled shape pipeline ({@link SHAPE_PIPELINE_DESCRIPTOR}). */
  readonly pipeline: GpuRenderPipeline;
  private readonly quad: GpuBuffer;
  /** One unclipped slot: the shader's clip table, which nothing here fills. */
  private readonly clipTable: ClipTableTexture;

  /**
   * Compiles the shape pipeline and uploads the unit quad. It writes a buffer, so it must not
   * be called while a render pass is open.
   *
   * @param backend - The backend to draw with.
   */
  constructor(private readonly backend: GpuBackend) {
    this.pipeline = backend.createRenderPipeline(SHAPE_PIPELINE_DESCRIPTOR);
    this.clipTable = new ClipTableTexture(backend);
    const corners = new Float32Array(SHAPE_UNCLIPPED_QUAD_VERTICES);
    this.quad = backend.createBuffer({
      usage: 'vertex',
      byteLength: corners.byteLength,
      label: 'sdf-shape-quad',
    });
    backend.writeBuffer(this.quad, 0, corners);
  }

  /**
   * Packs instances into a caller-provided slice of a CPU mirror of an instance buffer; the
   * caller uploads the dirty range with `writeBuffer` before the pass begins. Same as
   * {@link packShapeInstances}.
   *
   * @param instances - The shapes, in draw order; not mutated.
   * @param target - The destination floats.
   * @param firstRecord - The record the first instance is written at. Default 0.
   * @throws {RangeError} When the records do not fit `target`.
   */
  prepare(instances: readonly ShapeInstance[], target: Float32Array, firstRecord = 0): void {
    packShapeInstances(instances, target, firstRecord);
  }

  /**
   * Binds a camera uniform buffer (written with `packShapeCamera`) for {@link draw}, with the
   * renderer's unclipped clip table at binding 5 ({@link SHAPE_BINDINGS}).
   *
   * @param cameraBuffer - A uniform buffer of at least {@link SHAPE_CAMERA_BYTE_LENGTH} bytes.
   * @returns The bind group.
   * @throws {RangeError} When the buffer is too small for the camera block.
   */
  createCameraBindGroup(cameraBuffer: GpuBuffer): GpuBindGroup {
    if (cameraBuffer.byteLength < SHAPE_CAMERA_BYTE_LENGTH) {
      throw new RangeError(
        `The shape camera buffer needs ${String(SHAPE_CAMERA_BYTE_LENGTH)} bytes; it has ${String(cameraBuffer.byteLength)}.`,
      );
    }
    return this.backend.createBindGroup({
      pipeline: this.pipeline,
      entries: [
        { binding: 0, buffer: cameraBuffer },
        { binding: CLIP_TABLE_BINDING, texture: this.clipTable.texture },
      ],
      label: 'sdf-shape-camera',
    });
  }

  /**
   * Draws a range of instance records, in record order, into an open pass. It records commands
   * only (no writes), so it is safe inside a pass; an empty range records nothing.
   *
   * @param pass - The open pass.
   * @param camera - A group from {@link createCameraBindGroup}.
   * @param instances - A `vertex` buffer of records laid out as {@link SHAPE_INSTANCE_BYTES}.
   * @param range - The records to draw.
   * @throws {RangeError} When the range is not whole records or runs past `instances`.
   */
  draw(
    pass: GpuRenderPass,
    camera: GpuBindGroup,
    instances: GpuBuffer,
    range: ShapeInstanceRange,
  ): void {
    assertWholeCount('first', range.first);
    assertWholeCount('count', range.count);
    if ((range.first + range.count) * SHAPE_INSTANCE_BYTES > instances.byteLength) {
      throw new RangeError(
        `Shape records ${String(range.first)}–${String(range.first + range.count - 1)} run past a ${String(instances.byteLength)}-byte instance buffer.`,
      );
    }
    if (range.count === 0) {
      return;
    }
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(camera);
    pass.setVertexBuffer(0, this.quad);
    pass.setVertexBuffer(1, instances);
    pass.draw(SHAPE_QUAD_VERTEX_COUNT, range.count, 0, range.first);
  }

  /** Frees the pipeline, the quad and clip table. Instance and camera buffers are the caller's. */
  destroy(): void {
    this.pipeline.destroy();
    this.quad.destroy();
    this.clipTable.destroy();
  }
}

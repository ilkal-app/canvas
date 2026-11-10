import type { GpuBindingLayoutEntry, GpuRenderPipelineDescriptor } from '../gpu/gpu-pipeline.js';
import { SDF_SHAPE_SHADER } from '../gpu/shaders/sdf-shape.generated.js';
import { CLIP_TABLE_BINDING } from '../scene/clip-table-texture.js';

import { SHAPE_VERTEX_BUFFERS } from './shape-instance-layout.js';

/** Vertices per shape instance: the unit quad as two triangles. */
export const SHAPE_QUAD_VERTEX_COUNT = 6;

/**
 * The unit quad's corners, an `(x, y)` pair per vertex, two triangles: the contents of the scene
 * shape passes' per-vertex buffer (slot 0, `float32x2`). The vertex shader scales it to each
 * instance's padded rect. Frozen; upload it as `new Float32Array(SHAPE_QUAD_CORNERS)`.
 */
export const SHAPE_QUAD_CORNERS: readonly number[] = Object.freeze([
  0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
]);

/**
 * The unit quad's corners of {@link SHAPE_QUAD_CORNERS}, each followed by four corner radii of 0:
 * the contents of the shape passes' per-vertex buffer (`SHAPE_QUAD_VERTEX_LAYOUT`), so
 * a shape draws its record's one radius. Frozen; upload it as
 * `new Float32Array(SHAPE_QUAD_VERTICES)`.
 */
export const SHAPE_QUAD_VERTICES: readonly number[] = Object.freeze(
  SHAPE_QUAD_CORNERS.flatMap((value, index) => (index % 2 === 1 ? [value, 0, 0, 0, 0] : [value])),
);

/**
 * The unit quad's corners of {@link SHAPE_QUAD_CORNERS}, each followed by a clip index of 0, a
 * layer transparency of 0 and four corner radii of 0: the contents of the
 * standalone shape pipeline's per-vertex buffer (`SHAPE_UNCLIPPED_QUAD_VERTEX_LAYOUT`). Frozen;
 * upload it as `new Float32Array(SHAPE_UNCLIPPED_QUAD_VERTICES)`.
 */
export const SHAPE_UNCLIPPED_QUAD_VERTICES: readonly number[] = Object.freeze(
  SHAPE_QUAD_CORNERS.flatMap((value, index) =>
    index % 2 === 1 ? [value, 0, 0, 0, 0, 0, 0] : [value],
  ),
);

/**
 * The shape pipeline's group-0 bindings: the camera uniform buffer at binding 0 and the clip
 * table at binding 5 (`ShapeRenderer` binds one unclipped slot).
 */
export const SHAPE_BINDINGS: readonly GpuBindingLayoutEntry[] = Object.freeze([
  { binding: 0, kind: 'uniform-buffer' },
  { binding: CLIP_TABLE_BINDING, kind: 'load-texture' },
]);

/**
 * Everything needed to create the shape pipeline, as plain data, so a scene pass can register
 * it without going through `ShapeRenderer`: the SDF shape shader, the unit-quad and
 * instance vertex buffers, the camera binding and premultiplied blending. No stencil: shapes are
 * drawn in z-order within their segment.
 */
export const SHAPE_PIPELINE_DESCRIPTOR: GpuRenderPipelineDescriptor = Object.freeze({
  shader: SDF_SHAPE_SHADER,
  vertexBuffers: SHAPE_VERTEX_BUFFERS,
  bindings: SHAPE_BINDINGS,
  blend: 'premultiplied',
  label: 'sdf-shape',
});

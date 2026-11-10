// The vector glyph tier's GPU pipelines: per text run, its glyph triangles into the
// stencil, counted non-zero (front faces up, back faces down) with Loop–Blinn discards past each
// curve; then its edge hulls, painting each edge's analytic coverage once per sample and marking
// it; then a cover quad of the run's bounds where the count is not 0, painting the
// run's colour and zeroing the count; then the quad again, clearing the hulls' marks. Both read the run's instance record (the path
// pass's layout: placement and colour, then the scene's clip index and layer transparency), so a
// move rewrites one record and never the mesh. The cover is the path pass's shader, a scene
// shader under the clip contract: it multiplies its coverage, never discards, so the
// stencil is zeroed under clipped-out pixels too.
import type { GpuBackend } from '../../gpu/gpu-backend.js';
import type { GpuBindGroup } from '../../gpu/gpu-bind-group.js';
import type { GpuBuffer } from '../../gpu/gpu-buffer.js';
import type { GpuColorWrite, GpuRenderPipeline, GpuStencilState } from '../../gpu/gpu-pipeline.js';
import type { GpuShaderSource } from '../../gpu/gpu-shader.js';
import { MOVE_INDEX_LAYOUT, type MovePlacementBinding } from '../../gpu/move-placement.js';
import { GLYPH_EDGE_MOVE_SHADER } from '../../gpu/shaders/glyph-edge-move.generated.js';
import { GLYPH_EDGE_SHADER } from '../../gpu/shaders/glyph-edge.generated.js';
import { GLYPH_STENCIL_MOVE_SHADER } from '../../gpu/shaders/glyph-stencil-move.generated.js';
import { GLYPH_STENCIL_SHADER } from '../../gpu/shaders/glyph-stencil.generated.js';
import { PATH_MOVE_SHADER } from '../../gpu/shaders/path-move.generated.js';
import { PATH_SHADER } from '../../gpu/shaders/path.generated.js';
import type { GpuVertexBufferLayout } from '../../gpu/vertex-layout.js';
import { CLIP_TABLE_BINDING, type ClipTableTexture } from '../../scene/clip-table-texture.js';
import type { InstanceLayout } from '../../scene/instance-layout.js';

import type { GlyphBounds } from './glyph-geometry.js';

/** A run mesh's vertices (`buildVectorRunMesh`): x, y in the object's frame, then u, v. */
export const GLYPH_STENCIL_VERTEX_LAYOUT: GpuVertexBufferLayout = {
  stepMode: 'vertex',
  attributes: [
    { location: 0, format: 'float32x2' },
    { location: 3, format: 'float32x2' },
  ],
};

/**
 * A run's edge hulls (`buildVectorRunMesh`'s `edges`): the edge's start, control point
 * and end, the hull corner, the kind and side, the neighbours' outward normals, then the joins.
 */
export const GLYPH_EDGE_VERTEX_LAYOUT: GpuVertexBufferLayout = {
  stepMode: 'vertex',
  attributes: [
    { location: 0, format: 'float32x2' },
    { location: 3, format: 'float32x2' },
    { location: 4, format: 'float32x2' },
    { location: 5, format: 'float32x2' },
    { location: 6, format: 'float32' },
    { location: 8, format: 'float32x2' },
    { location: 9, format: 'float32x2' },
    { location: 10, format: 'float32x2' },
  ],
};

/** A cover quad's vertices ({@link vectorCoverQuad}): x, y in the object's frame. */
export const VECTOR_COVER_VERTEX_LAYOUT: GpuVertexBufferLayout = {
  stepMode: 'vertex',
  attributes: [{ location: 0, format: 'float32x2' }],
};

/** The stencil bit that marks a sample an edge hull painted. */
const PAINTED_BIT = 0x80;
/** The stencil bits that count windings. */
const COUNT_BITS = 0x7f;

/**
 * The stencil count: non-zero, front faces incrementing and back faces decrementing, in the low
 * seven bits (the top one marks what the edge hulls paint).
 */
export const VECTOR_STENCIL_STATE: GpuStencilState = {
  compare: 'always',
  passOperation: 'increment-wrap',
  backPassOperation: 'decrement-wrap',
  writeMask: COUNT_BITS,
};

/**
 * The edge hulls: where the painted bit is clear, painting with their edges' coverage
 * and replacing the count with the painted bit, so each sample is painted once.
 */
export const VECTOR_EDGE_STATE: GpuStencilState = {
  compare: 'not-equal',
  reference: PAINTED_BIT,
  readMask: PAINTED_BIT,
  passOperation: 'replace',
  writeMask: 0xff,
};

/** The cover: where the count is not 0 (the hulls' samples hold none), zeroing it. */
export const VECTOR_COVER_STATE: GpuStencilState = {
  compare: 'not-equal',
  reference: 0,
  readMask: COUNT_BITS,
  passOperation: 'zero',
};

/** The cleanup: the cover quad again, colour off, zeroing what the hulls marked. */
export const VECTOR_CLEANUP_STATE: GpuStencilState = {
  compare: 'not-equal',
  reference: 0,
  readMask: 0xff,
  passOperation: 'zero',
};

/** The vector glyph tier's four pipelines and the bind group they share. */
export interface VectorTextPipelines {
  /** A run's glyph triangles into the stencil, colour off. */
  readonly count: GpuRenderPipeline;
  /** A run's edge hulls, painting their edges' coverage. */
  readonly edges: GpuRenderPipeline;
  /** A run's cover quad, painting where the stencil counted and no hull painted. */
  readonly cover: GpuRenderPipeline;
  /** A run's cover quad again, colour off, clearing the hulls' marks. */
  readonly cleanup: GpuRenderPipeline;
  /**
   * The camera at binding 0, the retained-move placement table at 4 with one, and the clip table
   * at 5; rebuilt when the clip table's texture is replaced. Every pipeline declares the same
   * group-0 layout, so it stays valid across their switches.
   */
  readonly bindGroup: GpuBindGroup;
}

/**
 * Creates the vector glyph tier's pipelines on a backend: the count (`glyph-stencil.wgsl`)
 * with a run's mesh at vertex slot 0, the edge hulls (`glyph-edge.wgsl`) with its
 * hulls there, and the cover and cleanup (the path pass's shader) with a cover quad there, each
 * with the pass's records at slot 1 (and the retained-move index at slot 2 with a placement
 * table, in their move variants).
 *
 * @param backend - The backend.
 * @param layout - The pass's record layout.
 * @param cameraBuffer - The camera uniform buffer, bound at binding 0.
 * @param clipTable - The scene's clip table, bound at binding 5.
 * @param label - A label prefix for GPU debuggers.
 * @param placement - The retained-move placement table, for the move variants.
 * @returns The pipelines and their bind group.
 */
export function createVectorTextPipelines(
  backend: GpuBackend,
  layout: InstanceLayout,
  cameraBuffer: GpuBuffer,
  clipTable: ClipTableTexture,
  label: string,
  placement?: MovePlacementBinding,
): VectorTextPipelines {
  const isMoving = placement !== undefined;
  const create = (
    name: string,
    shader: GpuShaderSource,
    vertices: GpuVertexBufferLayout,
    colorWrite: GpuColorWrite,
    stencil: GpuStencilState,
  ): GpuRenderPipeline =>
    backend.createRenderPipeline({
      shader,
      vertexBuffers: [
        vertices,
        layout.vertexBufferLayout,
        ...(isMoving ? [MOVE_INDEX_LAYOUT] : []),
      ],
      bindings: [
        { binding: 0, kind: 'uniform-buffer' },
        ...(isMoving ? [{ binding: 4, kind: 'load-texture' as const }] : []),
        { binding: CLIP_TABLE_BINDING, kind: 'load-texture' },
      ],
      blend: 'premultiplied',
      colorWrite,
      stencil,
      label: `${label} ${name}`,
    });
  const count = create(
    'count',
    isMoving ? GLYPH_STENCIL_MOVE_SHADER : GLYPH_STENCIL_SHADER,
    GLYPH_STENCIL_VERTEX_LAYOUT,
    'none',
    VECTOR_STENCIL_STATE,
  );
  const edges = create(
    'edges',
    isMoving ? GLYPH_EDGE_MOVE_SHADER : GLYPH_EDGE_SHADER,
    GLYPH_EDGE_VERTEX_LAYOUT,
    'all',
    VECTOR_EDGE_STATE,
  );
  const coverShader = isMoving ? PATH_MOVE_SHADER : PATH_SHADER;
  const cover = create('cover', coverShader, VECTOR_COVER_VERTEX_LAYOUT, 'all', VECTOR_COVER_STATE);
  const cleanup = create(
    'cleanup',
    coverShader,
    VECTOR_COVER_VERTEX_LAYOUT,
    'none',
    VECTOR_CLEANUP_STATE,
  );
  let clipTexture = clipTable.texture;
  let bindGroup: GpuBindGroup | undefined;
  return {
    count,
    edges,
    cover,
    cleanup,
    get bindGroup(): GpuBindGroup {
      if (bindGroup === undefined || clipTexture !== clipTable.texture) {
        clipTexture = clipTable.texture;
        bindGroup = backend.createBindGroup({
          pipeline: count,
          entries: [
            { binding: 0, buffer: cameraBuffer },
            ...(placement ? [{ binding: 4, texture: placement.table.texture }] : []),
            { binding: CLIP_TABLE_BINDING, texture: clipTable.texture },
          ],
          label: `${label} camera`,
        });
      }
      return bindGroup;
    },
  };
}

/**
 * Frees the pipelines.
 *
 * @param pipelines - The pipelines.
 */
export function destroyVectorTextPipelines(pipelines: VectorTextPipelines): void {
  pipelines.count.destroy();
  pipelines.edges.destroy();
  pipelines.cover.destroy();
  pipelines.cleanup.destroy();
}

/** Floats of a cover quad: two triangles of x, y. */
const COVER_QUAD_FLOATS = 12;

/**
 * The cover quad of a run's bounds: two triangles, (minX, minY) (maxX, minY) (maxX, maxY) and
 * (minX, minY) (maxX, maxY) (minX, maxY), in the object's frame.
 *
 * @param bounds - The run mesh's bounds.
 * @param out - Where to write the 12 floats, so a drawer can reuse one array; default a new one.
 * @returns `out`, or the new array.
 */
export function vectorCoverQuad(
  bounds: GlyphBounds,
  out = new Float32Array(COVER_QUAD_FLOATS),
): Float32Array {
  const { minX, minY, maxX, maxY } = bounds;
  out.set([minX, minY, maxX, minY, maxX, maxY, minX, minY, maxX, maxY, minX, maxY]);
  return out;
}

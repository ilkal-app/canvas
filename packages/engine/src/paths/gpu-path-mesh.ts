import type { GpuBuffer } from '../gpu/gpu-buffer.js';

import type { MeshJobResponse } from './mesh-job-payload.js';
import type { PathMeshArena, PathMeshPlacement } from './path-mesh-arena.js';
import { COVER_VERTEX_COUNT } from './path-mesh.js';

/** A path's mesh on the GPU, in its own frame (`buildPathMesh`'s layout). */
export interface GpuPathMesh {
  /**
   * The vertex buffer it is in, shared with other meshes (`PathMeshArena`): fans, cover quad,
   * stroke, from `firstVertex`; `undefined` when the mesh is empty.
   */
  readonly buffer: GpuBuffer | undefined;
  /** Where it is in the arena, to give back when it goes; `undefined` when empty. */
  readonly placement: PathMeshPlacement | undefined;
  /** Its vertex 0 in `buffer`: every draw of the mesh adds it to its first vertex. */
  readonly firstVertex: number;
  /** Fan vertices, from vertex 0. */
  readonly fillVertexCount: number;
  /** Stroke vertices, after the cover quad. */
  readonly strokeVertexCount: number;
  /** The mesh's size, bytes. */
  readonly byteLength: number;
  /**
   * A CPU copy of the stroke vertices (x, y pairs), kept for a batching pass, which
   * copies them into its batch buffers; `undefined` otherwise.
   */
  readonly strokeVertices?: Float32Array;
}

/**
 * Copies a built mesh into the pass's arena of shared vertex buffers; an empty mesh
 * takes no room. Call with no render pass open.
 *
 * @param arena - The pass's mesh arena.
 * @param response - The built mesh.
 * @param shouldKeepStrokeVertices - Whether to keep a CPU copy of the stroke vertices. Default false.
 * @returns The mesh on the GPU.
 */
export function uploadPathMesh(
  arena: PathMeshArena,
  response: MeshJobResponse,
  shouldKeepStrokeVertices = false,
): GpuPathMesh {
  const { vertices, fillVertexCount, strokeVertexCount } = response;
  if (vertices.length === 0) {
    return {
      buffer: undefined,
      placement: undefined,
      firstVertex: 0,
      fillVertexCount,
      strokeVertexCount,
      byteLength: 0,
    };
  }
  const placement = arena.place(vertices);
  return {
    buffer: placement.buffer,
    placement,
    firstVertex: placement.firstVertex,
    fillVertexCount,
    strokeVertexCount,
    byteLength: vertices.byteLength,
    ...(shouldKeepStrokeVertices && strokeVertexCount > 0
      ? { strokeVertices: vertices.slice((fillVertexCount + COVER_VERTEX_COUNT) * 2) }
      : {}),
  };
}

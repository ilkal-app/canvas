import type { WorldBounds } from '../camera/camera.js';

import type { FreehandMeshShape } from './freehand-mesh.js';
import type { LineMeshShape } from './line-mesh.js';
import type { PathNetwork } from './network-index.js';
import type { StrokeOutline } from './stroke-outline.js';

/**
 * A request to build one path's or line's mesh for one zoom bucket (path
 * flattening and mesh building run in a worker pool): flattening and meshing in one job, so
 * polylines never cross threads. Structured-cloneable.
 */
export interface MeshJobRequest {
  /** The path or line object the mesh draws. */
  readonly objectId: string;
  /** The version of the path's network the request was made from (the mesh cache's key). */
  readonly version: number;
  /** The zoom bucket, which sets the flattening tolerance (`flattenToleranceOf`). */
  readonly bucket: number;
  /** The path's vertices and segments, in its own frame; empty for a line. */
  readonly network: PathNetwork;
  /** A line's route and caps: present, the job builds a line's mesh, not a network's. */
  readonly line?: LineMeshShape;
  /** A freehand stroke's points, pressures and ends: present, the job builds its mesh. */
  readonly freehand?: FreehandMeshShape;
  /** The stroke's width, world units; 0 for no stroke. */
  readonly strokeWidth: number;
  /** Whether the path has a fill. */
  readonly isFilled: boolean;
  /**
   * The stroke's join, dash and cap (`strokeOutlineOf`), for a path's network or a
   * line's shaft; absent for none.
   */
  readonly outline?: StrokeOutline;
  /**
   * The flattening tolerance, world units, when it is not the bucket's
   * (`flattenToleranceOf(bucket)`): a chord mesh's (`chordMeshRequestOf`).
   */
  readonly tolerance?: number;
}

/** A built mesh (`buildPathMesh`, `buildLineMesh`), its vertex buffer transferred back. */
export interface MeshJobResponse {
  /** The path object the mesh draws. */
  readonly objectId: string;
  /** The network version it was built from. */
  readonly version: number;
  /** The zoom bucket it is accurate for. */
  readonly bucket: number;
  /** `x, y` per vertex: fill fans, the six cover vertices, then stroke triangles. */
  readonly vertices: Float32Array<ArrayBuffer>;
  /** Vertices of the fill's fans. */
  readonly fillVertexCount: number;
  /** Vertices of the stroke. */
  readonly strokeVertexCount: number;
  /** The box the mesh draws in, the path's own frame; `null` when it draws nothing. */
  readonly bounds: WorldBounds | null;
}

import type { BoardObject } from '@canvas/schema';

import type { PathFrameReport } from './path-frame-report.js';
import type { PathLayer } from './path-layers.js';
import type { PathMeshBuilder } from './path-mesh-builder.js';

/** How a path drawer builds and keeps meshes. */
export interface PathDrawerOptions {
  /** Builds meshes, at once or through a pool. */
  readonly meshBuilder: PathMeshBuilder;
  /** The mesh cache's cap, bytes. */
  readonly meshByteBudget: number;
  /**
   * How many path segments a frame may send for meshing (at least one path is always sent),
   * so a zoom across a bucket boundary spreads its rebuild over frames while the previous
   * bucket's meshes draw.
   */
  readonly maxMeshSegmentsPerFrame: number;
  /** Called at the end of every frame's mesh preparation, for tests and diagnostics. */
  readonly onFrame?: (report: PathFrameReport) => void;
  /** Reports failed/timed-out builds before their single inline retry; optional. */
  readonly onFault?: (error: Error) => void;
  /** Frames before an unanswered build times out. Default `MESH_BUILD_TIMEOUT_FRAMES`. */
  readonly buildTimeoutFrames?: number;
  /** The size of the vertex buffers meshes share, bytes; default `PATH_MESH_PAGE_BYTES`. */
  readonly meshPageBytes?: number;
  /** The layers the pass draws of an object; `pathLayersOf` if absent. */
  readonly layersOf?: (object: BoardObject) => readonly PathLayer[];
  /**
   * Whether runs of consecutive opaque strokes draw as one batched draw each (
   * `path-batch.wgsl`); fills and translucent strokes keep their per-path draws. Default false.
   */
  readonly isBatched?: boolean;
}

/** The stage that builds and uploads the frame's meshes, inserted before `draw`. */
export const PREPARE_PATH_MESHES_STAGE = 'preparePathMeshes';

/**
 * The mesh stage of a path pass: `preparePathMeshes` for the path pass, suffixed with the name of
 * another (the connector pass's), since a frame's stages need distinct names.
 *
 * @param passName - The pass.
 * @returns The stage's name.
 */
export function preparationStageOf(passName: string): string {
  return passName === 'path'
    ? PREPARE_PATH_MESHES_STAGE
    : `${PREPARE_PATH_MESHES_STAGE}.${passName}`;
}

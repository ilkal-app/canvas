import type { ConnectorObject, FreehandObject, LineObject, PathObject } from '@canvas/schema';

import { connectorMeshShapeOf } from '../connectors/connector-mesh.js';
import { readFill } from '../paint/paint-reading.js';
import type { JobHandler } from '../workers/job-handlers.js';

import { flattenToleranceOf } from './flatten-bucket.js';
import { buildFreehandMesh, freehandMeshShapeOf } from './freehand-mesh.js';
import { buildLineMesh, lineMeshShapeOf } from './line-mesh.js';
import type { MeshJobRequest, MeshJobResponse } from './mesh-job-payload.js';
import { buildPathMesh } from './path-mesh.js';
import { PLAIN_OUTLINE, strokeOutlineOf } from './stroke-outline.js';

/** A line's request carries no network. */
const NO_NETWORK = Object.freeze({ vertices: Object.freeze([]), segments: Object.freeze([]) });

/**
 * The `mesh` job's request for a path, a line, a connector or a freehand stroke at a zoom bucket.
 *
 * @param path - The path object, whose network is shared, not copied (a worker gets a clone), or
 *   the line or placed connector, whose route and caps are sent; with its stroke style's outline
 *   when it has one.
 * @param version - The version of its mesh input, as the path pass counts them.
 * @param bucket - The zoom bucket.
 * @returns The request.
 */
export function meshJobRequestOf(
  path: PathObject | LineObject | ConnectorObject | FreehandObject,
  version: number,
  bucket: number,
): MeshJobRequest {
  if (path.type === 'freehand') {
    return {
      objectId: path.id,
      version,
      bucket,
      network: NO_NETWORK,
      strokeWidth: path.stroke.width,
      isFilled: false,
      freehand: freehandMeshShapeOf(path),
    };
  }
  const outline = strokeOutlineOf(path);
  // An unstyled stroke's request carries no outline, as before.
  const styled = outline === PLAIN_OUTLINE ? {} : { outline };
  if (path.type !== 'path') {
    return {
      ...styled,
      objectId: path.id,
      version,
      bucket,
      network: NO_NETWORK,
      strokeWidth: path.stroke.width,
      isFilled: false,
      line: path.type === 'line' ? lineMeshShapeOf(path) : connectorMeshShapeOf(path),
    };
  }
  return {
    ...styled,
    objectId: path.id,
    version,
    bucket,
    network: { vertices: path.vertices, segments: path.segments },
    strokeWidth: path.stroke?.width ?? 0,
    isFilled: readFill(path.fill) !== null,
  };
}

/**
 * Builds a `mesh` job's mesh on the calling thread: the synchronous path, which the path pass
 * uses by default and the job handler wraps. A request with a `line` builds a line's mesh.
 *
 * @param request - The path's network (or the line's route and caps), stroke width, fill flag,
 *   version and bucket.
 * @returns The mesh, with the request's ids.
 */
export function runMeshJob(request: MeshJobRequest): MeshJobResponse {
  const tolerance = request.tolerance ?? flattenToleranceOf(request.bucket);
  const { line, outline, freehand } = request;
  const mesh = freehand
    ? buildFreehandMesh({ ...freehand, strokeWidth: request.strokeWidth, tolerance })
    : line
      ? buildLineMesh({ ...line, strokeWidth: request.strokeWidth, tolerance, outline })
      : buildPathMesh({
          network: request.network,
          strokeWidth: request.strokeWidth,
          isFilled: request.isFilled,
          tolerance,
          outline,
        });
  return {
    objectId: request.objectId,
    version: request.version,
    bucket: request.bucket,
    vertices: mesh.vertices,
    fillVertexCount: mesh.fillVertexCount,
    strokeVertexCount: mesh.strokeVertexCount,
    bounds: mesh.bounds ?? null,
  };
}

/**
 * Handles `mesh` jobs in a job worker or in the pool's main-thread fallback: flattens and
 * meshes the path and transfers the vertex buffer back.
 *
 * @param request - The path's network, stroke width, fill flag, version and bucket.
 * @returns The mesh and its transfer list.
 */
export const meshJob: JobHandler<'mesh'> = (request) => {
  const response = runMeshJob(request);
  return { response, transfer: [response.vertices.buffer] };
};

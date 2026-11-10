import type {
  BoardObject,
  ConnectorObject,
  FreehandObject,
  LineObject,
  PathObject,
} from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import type { PassLevelOfDetail } from '../lod/level-of-detail.js';
import { LOD_HYSTERESIS, PATH_CHORD_BOUNDS_PX, PATH_LOD_RULE } from '../lod/lod-thresholds.js';

import { drawnLocalBounds, isDrawnPath, isSameDrawnMesh } from './drawn-path.js';
import { FLATTEN_TOLERANCE_PX } from './flatten-bucket.js';
import type { MeshJobRequest } from './mesh-job-payload.js';
import { meshJobRequestOf } from './mesh-job.js';

/**
 * The mesh cache's bucket for a path's chord form: far below every zoom bucket
 * (`pickFlattenBucket` gives about −24 at the smallest zoom), so a chord mesh is never taken for
 * a zoom bucket's and is built once per path version, whatever the zoom.
 */
export const CHORD_BUCKET = -1_000;

/**
 * The longer side of a path's or a line's box, world units: the size the path rule measures.
 *
 * @param bounds - The box.
 * @returns Its longer side; 0 for an empty box.
 */
function longerSide(bounds: WorldBounds): number {
  const side = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  return Number.isFinite(side) ? side : 0;
}

/**
 * The path pass's level-of-detail rule: a path or line whose box's longer side is under
 * 6 device pixels draws a straight chord per segment (`chordMeshRequestOf`), with a 20% band
 * (`PATH_LOD_RULE`).
 */
export const PATH_LEVEL_OF_DETAIL: PassLevelOfDetail = {
  rule: PATH_LOD_RULE,
  sizeOf(object: BoardObject): number {
    return isDrawnPath(object) ? longerSide(drawnLocalBounds(object)) : 0;
  },
  // The box depends on the network or points, the stroke width and a line's caps, all mesh
  // input: a move or a recolour measures nothing.
  isSameSize: (previous, next) =>
    isDrawnPath(previous) && isDrawnPath(next) && isSameDrawnMesh(previous, next),
};

/**
 * The `mesh` job's request for a path's chord form: every segment straight from end to end
 * (its handles on its vertices, so flattening gives the chord), the stroke, joins and fill
 * built at a quarter of a device pixel at the largest scale the chord form is drawn at (its box
 * 20% past 6 device pixels), so one chord mesh serves every zoom below it and its joins and caps
 * take the fewest triangles. A line or connector keeps its route and heads at that tolerance.
 * Pure.
 *
 * @param path - The path, line or connector.
 * @param version - The version of its mesh input, as the path pass counts them.
 * @param bounds - Its box in its own frame (`pathLocalBounds`, `lineLocalBounds`).
 * @returns The request, at {@link CHORD_BUCKET}.
 */
export function chordMeshRequestOf(
  path: PathObject | LineObject | ConnectorObject | FreehandObject,
  version: number,
  bounds: WorldBounds,
): MeshJobRequest {
  const request = meshJobRequestOf(path, version, CHORD_BUCKET);
  const largestScale =
    (PATH_CHORD_BOUNDS_PX * (1 + LOD_HYSTERESIS)) / Math.max(longerSide(bounds), 1e-6);
  const tolerance = FLATTEN_TOLERANCE_PX / largestScale;
  // A freehand stroke's curve is flattened at the chord tolerance, which a 6 px box needs.
  if (path.type !== 'path') return { ...request, tolerance };
  const straight = { x: 0, y: 0 };
  const segments = path.segments.map((segment) => ({ ...segment, ha: straight, hb: straight }));
  return { ...request, tolerance, network: { vertices: path.vertices, segments } };
}

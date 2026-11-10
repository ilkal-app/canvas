// The paths area's public API (vector geometry, meshes, the mesh cache and the path pass),
// re-exported by the package entry, src/index.ts, which would otherwise pass 400 lines.
export {
  cubicBounds,
  cubicOf,
  evalCubic,
  flattenCubic,
  isStraightCubic,
  nearestOnCubic,
  splitCubic,
} from './bezier.js';
export type { Cubic, NearestOnCubic, VertexLookup } from './bezier.js';
export { capLength, capLengthOn, capReach, capShapeOf } from './caps.js';
export type { CapShape } from './caps.js';
export {
  closedLoops,
  flattenChain,
  flattenChainCorners,
  isolatedVertices,
  loopCubics,
  strokeChains,
} from './chains.js';
export { elbowRoute, lineRouteOf } from './elbow-route.js';
export type { FlattenedChain, StrokeChain } from './chains.js';
export { fanMesh, fillMesh } from './fill-mesh.js';
export {
  FLATTEN_BUCKET_HYSTERESIS,
  FLATTEN_TOLERANCE_PX,
  flattenToleranceOf,
  pickFlattenBucket,
} from './flatten-bucket.js';
export { buildLineMesh, lineLocalBounds, lineMeshShapeOf } from './line-mesh.js';
export type { LineMeshInput, LineMeshShape } from './line-mesh.js';
export {
  buildFreehandMesh,
  freehandHalfWidth,
  freehandMeshShapeOf,
  isSameFreehandMesh,
  MARKER_MIN_WIDTH_SHARE,
} from './freehand-mesh.js';
export type { FreehandMeshInput, FreehandMeshShape } from './freehand-mesh.js';
export { lineShapeOf } from './line-shape.js';
export type { LineShape, LineShapeInput } from './line-shape.js';
export { MESH_BUILD_TIMEOUT_FRAMES } from './mesh-builds.js';
export { MeshCache } from './mesh-cache.js';
export { CHORD_BUCKET, chordMeshRequestOf, PATH_LEVEL_OF_DETAIL } from './chord-mesh.js';
export type { CachedMesh, MeshCacheOptions } from './mesh-cache.js';
export { meshJob, meshJobRequestOf, runMeshJob } from './mesh-job.js';
export type { MeshJobRequest, MeshJobResponse } from './mesh-job-payload.js';
export { edgesOf, indexNetwork } from './network-index.js';
export type { NetworkEdge, NetworkIndex, PathNetwork } from './network-index.js';
export { PREPARE_PATH_MESHES_STAGE } from './path-drawer.js';
export type { PathFrameReport } from './path-frame-report.js';
export { pathLayersOf } from './path-layers.js';
export type { PathLayer } from './path-layers.js';
export { assembleMesh, buildPathMesh, COVER_VERTEX_COUNT } from './path-mesh.js';
export type { PathMeshData, PathMeshInput } from './path-mesh.js';
export { createPooledMeshBuilder, INLINE_MESH_BUILDER } from './path-mesh-builder.js';
export type { MeshJobSubmitter, PathMeshBuilder } from './path-mesh-builder.js';
export {
  CONNECTOR_MESH_BYTE_BUDGET,
  createGradientPathPass,
  createPathPass,
  DEFAULT_MAX_MESH_SEGMENTS_PER_FRAME,
  DEFAULT_MESH_BYTE_BUDGET,
  PATH_GRADIENT_PASS_NAME,
} from './path-pass.js';
export type { PathPassContent, PathPassOptions } from './path-pass.js';
export { arcSteps, resolveCaps, writeDot } from './stroke-caps.js';
export type { StrokeCapOption, StrokeCaps, StrokeCapStyle } from './stroke-caps.js';
export { dashIntervals, MAX_DASHES } from './stroke-dash.js';
export type { DashInterval } from './stroke-dash.js';
export { strokeMesh, writeStroke } from './stroke-mesh.js';
export {
  isSameStrokeStyle,
  PLAIN_OUTLINE,
  roundJoined,
  strokeOutlineOf,
  strokeOutlineReach,
} from './stroke-outline.js';
export type { DashPattern, StrokeOutline } from './stroke-outline.js';
export { TriangleWriter } from './triangle-writer.js';

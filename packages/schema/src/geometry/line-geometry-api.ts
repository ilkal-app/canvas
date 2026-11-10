// The connector and line geometry the engine draws and the vector export follows:
// routes, label points, caps, line shapes, stroke outlines and cubic flattening. Pure.
export { evalCubic, flattenCubic, isStraightCubic, splitCubic, type Cubic } from './bezier.js';
export {
  capLength,
  capLengthOn,
  capReach,
  capShaftInset,
  capShaftStyle,
  capShapeOf,
  type CapShape,
} from './caps.js';
export { connectorLabelPoint, connectorPolylineOf } from './connector-label.js';
export {
  connectorPathOf,
  cubicMidpoint,
  CURVE_HANDLE_FRACTION,
  curvedConnectorCubic,
  curvePointOf,
  curvePointPosition,
  ELBOW_STUB,
  elbowConnectorRoute,
  elbowMiddlePiece,
  type ConnectorPath,
  type ConnectorRouteHandles,
  type ElbowMiddlePiece,
} from './connector-path.js';
export { connectorShapeFrom, type ConnectorShape } from './connector-shape.js';
export { elbowRoute, lineRouteOf } from './elbow-route.js';
export {
  FLATTEN_BUCKET_HYSTERESIS,
  FLATTEN_TOLERANCE_PX,
  flattenToleranceOf,
  pickFlattenBucket,
} from './flatten-bucket.js';
export { lineShapeOf, type LineShape, type LineShapeInput } from './line-shape.js';
export {
  resolveCaps,
  type StrokeCapOption,
  type StrokeCaps,
  type StrokeCapStyle,
} from './stroke-caps.js';
export {
  isSameStrokeStyle,
  PLAIN_OUTLINE,
  roundJoined,
  strokeOutlineOf,
  strokeOutlineReach,
  type DashPattern,
  type StrokeOutline,
} from './stroke-outline.js';

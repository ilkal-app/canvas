// The freehand stroke's pure geometry, re-exported whole by the package index.
export {
  FREEHAND_FLATTEN_TOLERANCE,
  flattenFreehand,
  freehandCenterDistance,
  freehandCurve,
  freehandLocalBounds,
} from './freehand-curve.js';
export type { FreehandBounds, FreehandSegment } from './freehand-curve.js';
export {
  FREEHAND_PRESSURE_TOLERANCE,
  FREEHAND_SIMPLIFY_PX,
  freehandFieldsOf,
  freehandPointsOf,
  freehandSamplesOf,
  freehandTolerance,
  simplifyFreehand,
  smoothFreehand,
  splitFreehand,
} from './freehand-samples.js';
export type { FreehandFields, FreehandSample, FreehandStoredFields } from './freehand-samples.js';

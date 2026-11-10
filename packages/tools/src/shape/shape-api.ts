// The shape area's public API, re-exported whole by the package's index, which would
// otherwise pass the 400-line limit: the shape tool's mode, the shape a drag makes, the drag's
// geometry and its snapping.
export { snapCreationPoint } from './creation-snap.js';
export type { CreationSnapRequest, CreationSnapSource } from './creation-snap.js';
export { DEFAULT_SHAPE_STYLE, newShapeObject } from './new-shape-object.js';
export type {
  NewShapeObject,
  NewShapeStroke,
  NewShapeStyle,
  ShapeBox,
} from './new-shape-object.js';
export { clickedShapeBox, DEFAULT_SHAPE_SIZE, MIN_SHAPE_SIZE, shapeDragBox } from './shape-drag.js';
export type { ShapeDragModifiers } from './shape-drag.js';
export { ShapeMode } from './shape-mode.js';
export type { ShapeModeContext, ShapeModeStart } from './shape-mode.js';

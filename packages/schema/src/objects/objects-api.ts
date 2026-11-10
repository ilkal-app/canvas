// The object types' public API (every object schema, its type and its constants), re-exported by
// the package entry, src/index.ts, which would otherwise pass 400 lines.
export { componentObjectSchema, variantPresetIssues } from './component-object.js';
export type { ComponentObject } from './component-object.js';
export { instanceObjectSchema } from './instance-object.js';
export type { InstanceObject } from './instance-object.js';
export { baseObjectSchema, MAX_OBJECT_NAME_LENGTH, type BaseObject } from './base-object.js';
export { boardObjectSchema } from './board-object.js';
export type { BoardObject, BoardObjectOf } from './board-object.js';
export { commentAnchorSchema, commentObjectSchema } from './comment-object.js';
export type { CommentAnchor, CommentObject } from './comment-object.js';
export {
  CONNECTOR_ROUTES,
  connectorCurvePointSchema,
  connectorEndSchema,
  connectorObjectSchema,
  MAX_CURVE_POINT_REACH,
} from './connector-object.js';
export type { ConnectorCurvePoint, ConnectorEnd, ConnectorObject } from './connector-object.js';
export { isFrameNameShown } from './frame-name-shown.js';
export type { FrameNameAncestor } from './frame-name-shown.js';
export { frameObjectSchema } from './frame-object.js';
export type { FrameObject } from './frame-object.js';
export { groupObjectSchema } from './group-object.js';
export type { GroupObject } from './group-object.js';
export { cropSchema, imageObjectSchema } from './image-object.js';
export type { Crop, ImageObject } from './image-object.js';
export { LINE_ROUTES, lineObjectSchema } from './line-object.js';
export type { LineObject } from './line-object.js';
export { OBJECT_TYPES, objectTypeSchema } from './object-type.js';
export type { ObjectType } from './object-type.js';
export { findNetworkIssues, MIRROR_MODES, segmentSchema, vertexSchema } from './path-network.js';
export type { Segment, Vertex } from './path-network.js';
export { pathObjectSchema } from './path-object.js';
export type { PathObject } from './path-object.js';
export {
  findFreehandIssues,
  FREEHAND_TOOLS,
  freehandObjectSchema,
  MAX_FREEHAND_POINTS,
} from './freehand-object.js';
export type { FreehandObject, FreehandTool } from './freehand-object.js';
export {
  CONNECTOR_HANDLES_VERSION,
  CONNECTOR_LABEL_POSITION_VERSION,
  FREEHAND_VERSION,
  IMAGE_BORDER_VERSION,
  LINK_CARD_VERSION,
  LINK_VERSION,
  RUN_LINK_VERSION,
} from '../version/schema-version.js';
// The stroke's pure geometry beside its type.
export * from '../geometry/freehand-geometry-api.js';
export { MAX_SHAPE_SIDES, SHAPE_KINDS, shapeObjectSchema } from './shape-object.js';
export type { ShapeObject } from './shape-object.js';
export { STICKY_ASPECTS, stickyAspectSchema, stickyObjectSchema } from './sticky-object.js';
export type { StickyAspect, StickyObject } from './sticky-object.js';
export { TEXT_ALIGNS, TEXT_DIRECTIONS, textObjectSchema, VERTICAL_ALIGNS } from './text-object.js';
export type { TextObject } from './text-object.js';
export { trimSchema, videoObjectSchema } from './video-object.js';
export type { Trim, VideoObject } from './video-object.js';
export {
  clipLinkText,
  LINK_LAYOUTS,
  LINK_STATUSES,
  LINK_TEXT_LIMITS,
  linkObjectSchema,
} from './link-object.js';
export type {
  LinkLayout,
  LinkObject,
  LinkStatus,
  LinkText,
  LinkTextLimits,
} from './link-object.js';
export {
  LINK_MAX_LENGTH,
  LINK_PROTOCOLS,
  linkSchema,
  linkShape,
  normalizeLink,
} from '../fields/link.js';

// The level-of-detail area's public exports, re-exported whole by the package entry.
export { LevelOfDetail } from './level-of-detail.js';
export type {
  LevelOfDetailOptions,
  LodBand,
  LodCounters,
  LodHistory,
  LodPass,
  PassLevelOfDetail,
} from './level-of-detail.js';
export { createLevelOfDetailStage, LEVEL_OF_DETAIL_STAGE_NAME } from './level-of-detail-stage.js';
export { bandSideOf, lodEdgesOf, lodFormAt, lodFormOf, lodLevelOf } from './lod-form.js';
export type { LodForm, LodLevel, LodRule } from './lod-rule.js';
export {
  CONNECTOR_HIDDEN_STROKE_PX,
  CONNECTOR_LOD_RULE,
  FRAME_TITLE_HIDDEN_WIDTH_PX,
  FRAME_TITLE_LOD_RULE,
  IMAGE_AVERAGE_COLOR_EDGE_PX,
  IMAGE_LOD_RULE,
  LOD_HYSTERESIS,
  PATH_CHORD_BOUNDS_PX,
  PATH_LOD_RULE,
  SHAPE_FLAT_EDGE_PX,
  SHAPE_LOD_RULE,
  TEXT_GREEK_LINE_PX,
  TEXT_HIDDEN_LINE_PX,
  TEXT_LOD_RULE,
} from './lod-thresholds.js';

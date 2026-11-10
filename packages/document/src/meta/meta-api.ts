// The stored layout and its gate's public API (document metadata, the layout versions, the
// relay's gate and stamp checks), re-exported by the package entry, src/index.ts, which would
// otherwise pass 400 lines.
export {
  createDocumentMeta,
  DOCUMENT_LAYOUT_VERSION,
  DOCUMENT_META_KEY,
  INSTANCE_SCALE_LAYOUT_VERSION,
  isReadableMeta,
  META_MAP_NAME,
  NAMED_STYLES_LAYOUT_VERSION,
  NEGATIVE_GAP_LAYOUT_VERSION,
  READABLE_LAYOUT_VERSIONS,
  STROKE_ALIGN_LAYOUT_VERSION,
  PRESET_GEOMETRY_LAYOUT_VERSION,
  OBJECT_NAME_LAYOUT_VERSION,
  FRAME_RADIUS_LAYOUT_VERSION,
  LAYER_OPACITY_LAYOUT_VERSION,
  LAYER_VISIBILITY_LAYOUT_VERSION,
  STROKE_STYLE_SHADOW_LAYOUT_VERSION,
  RUN_LANGUAGE_LAYOUT_VERSION,
  POSTSCRIPT_NAME_LAYOUT_VERSION,
  FRAME_PAINT_OVERRIDE_LAYOUT_VERSION,
  FONT_FEATURES_LAYOUT_VERSION,
  STICKY_ASPECT_LAYOUT_VERSION,
  FREEHAND_LAYOUT_VERSION,
  LINK_LAYOUT_VERSION,
  RUN_LINK_LAYOUT_VERSION,
  IMAGE_BORDER_LAYOUT_VERSION,
  CONNECTOR_HANDLES_LAYOUT_VERSION,
  CONNECTOR_LABEL_POSITION_LAYOUT_VERSION,
  TEXT_LISTS_LAYOUT_VERSION,
  LINK_CARD_LAYOUT_VERSION,
  SWAP_LAYOUT_VERSION,
  TEXT_DIRECTION_LAYOUT_VERSION,
  FONT_VARIATIONS_LAYOUT_VERSION,
  VARIANTS_LAYOUT_VERSION,
} from './document-meta.js';
export type { DocumentMeta } from './document-meta.js';
export { DocumentVersionError } from './document-version-error.js';
export { isStampedDocument } from './is-stamped-document.js';
export {
  formatReadableLayouts,
  parseReadableLayouts,
  READABLE_LAYOUTS_PARAMETER,
} from './layout-declaration.js';
export {
  canReadBoardLayout,
  FIRST_GATED_LAYOUT_VERSION,
  INCOMPLETE_UPDATE_CLOSE_CODE,
  INCOMPLETE_UPDATE_REASON,
  UPDATE_DEPTH_REASON,
  UPDATE_MALFORMED_REASON,
  INVALID_STAMP_REASON,
  isAcceptableStamp,
  isLayoutGateReason,
  LAYOUT_GATE_CLOSE_CODE,
  readBoardLayout,
  TOO_MANY_CLIENTS_REASON,
  UNREADABLE_LAYOUT_REASON,
  UNSTAMPED_WRITE_REASON,
} from './layout-gate.js';
export type { BoardLayout } from './layout-gate.js';
export { stampDocument } from './stamp-document.js';
export { MAX_STAMP_CHECK_STEPS, UpdateStampCheck } from './update-stamp-check.js';
export { holdsUndecodableContent } from './undecodable-content.js';
export { countUpdateClients, MAX_UPDATE_CLIENTS } from './update-client-bound.js';
export type { StampCheckVerdict, UnprovableCause } from './update-stamp-check.js';
export type { HostileValue } from './field-values.js';
export type { DocumentVersionProblem } from './document-version-error.js';

export {
  ASSET_STATUSES,
  assetLevelSchema,
  assetRecordSchema,
  assetTilesSchema,
  IMAGE_LEVEL_FORMATS,
  IMAGE_LEVEL_LONG_EDGES_PX,
  MAX_BLURHASH_LENGTH,
  TILE_SIZE_PX,
} from './assets/asset-record.js';
export type {
  AssetLevel,
  AssetRecord,
  AssetStatus,
  AssetTiles,
  ImageLevelFormat,
} from './assets/asset-record.js';
export { createBoard, type Board } from './board/board.js';
export * from './instances/instances-api.js';
export * from './instances/variant-swap-api.js';
export {
  CONSTRAINT_MODES,
  constraintsSchema,
  DEFAULT_CONSTRAINTS,
  effectiveConstraints,
} from './fields/constraints.js';
export type { ConstraintMode, Constraints } from './fields/constraints.js';
export { buildChildIndex, type ChildIndex } from './board/child-index.js';
export { DRAWABLE_EXTENT, FLOAT32_MAX, MAX_DRAWABLE_SIZE } from './drawable/drawable-extent.js';
export type { UndrawableReason } from './drawable/drawable-extent.js';
export {
  capReason,
  colorReason,
  coordinateReason,
  cropExtentReason,
  cropReason,
  fontSizeReason,
  fontWeightReason,
  instanceScaleReason,
  letterSpacingReason,
  lineHeightReason,
  naturalSizeReason,
  pointReason,
  scalarReason,
  sidesReason,
  sizeReason,
  strokeReason,
  textRunsReason,
  unitReason,
} from './drawable/drawable-ranges.js';
export { drawableValuesReason } from './drawable/drawable-values.js';
export { paintReason, strokeValueReason } from './drawable/paint-values.js';
export type { PaintValueFinding, PaintValueReason } from './drawable/paint-values.js';
export { shadowValueReason } from './drawable/shadow-values.js';
export { strokeAlignValueReason } from './drawable/stroke-align-values.js';
export type {
  DrawableValueFinding,
  DrawableValueKind,
  DrawableValueReason,
} from './drawable/drawable-values.js';
export { isSameValue } from './drawable/stored-value-match.js';
export type { StoredValue, StoredValueReader } from './drawable/stored-value-match.js';
export { angleSchema, BOARD_BOUND, finiteCoordinate } from './fields/board-bound.js';
export {
  colorSchema,
  INK,
  INK_COLORS,
  inkableColorSchema,
  isInk,
  rgbaSchema,
} from './fields/color.js';
export type { Color, InkableColor, InkTheme, Rgba } from './fields/color.js';
export * from './styles/styles-api.js';
export * from './tokens/tokens-api.js';
export * from './facilitation/facilitation-api.js';
export {
  gradientPositionAt,
  gradientSchema,
  gradientStopSchema,
  gradientStopsSchema,
  imageFitSchema,
  imagePaintSchema,
  isGradient,
  isImagePaint,
  isPaintOpaque,
  isPaintVisible,
  linearGradientSchema,
  MAX_GRADIENT_STOPS,
  MAX_RADIAL_RADIUS,
  MIN_GRADIENT_STOPS,
  paintAverageColor,
  paintColorAt,
  paintSchema,
  radialGradientSchema,
  resolvePaint,
} from './fields/paint.js';
export type {
  ColorOrGradient,
  Gradient,
  GradientStop,
  ImageFit,
  ImagePaint,
  LinearGradient,
  Paint,
  RadialGradient,
  ResolvedPaint,
} from './fields/paint.js';
export { LINE_CAPS, lineCapSchema, type LineCap } from './fields/line-cap.js';
export { pointSchema, unitPointSchema } from './fields/point.js';
export type { Point, UnitPoint } from './fields/point.js';
export { MAX_STROKE_WIDTH, strokeSchema } from './fields/stroke.js';
export type { Stroke } from './fields/stroke.js';
export {
  DEFAULT_STROKE_MITER_LIMIT,
  MAX_STROKE_DASH_ENTRIES,
  MAX_STROKE_DASH_LENGTH,
  MAX_STROKE_DASH_OFFSET,
  MAX_STROKE_MITER_LIMIT,
  STROKE_CAPS,
  STROKE_JOINS,
  strokeCapSchema,
  strokeDashPatternSchema,
  strokeDashSchema,
  strokeJoinSchema,
  strokeMiterLimitSchema,
  strokeStyleFields,
} from './fields/stroke-style.js';
export type { StrokeCap, StrokeDash, StrokeJoin, StrokeStyle } from './fields/stroke-style.js';
export { strokeStyleReason } from './drawable/stroke-style-values.js';
export {
  DEFAULT_STROKE_ALIGN,
  frameStrokeFieldSchema,
  STROKE_ALIGNS,
  strokeAlignFieldSchema,
  strokeAlignSchema,
  strokeOutsetOf,
  strokeOutsideFraction,
} from './fields/stroke-align.js';
export type { StrokeAlign } from './fields/stroke-align.js';
export { frameCornerRadii, frameCornerRadiusSchema } from './fields/frame-radius.js';
export type { CornerRadii, FrameCornerRadius } from './fields/frame-radius.js';
export {
  LAYER_OPACITY_TYPES,
  layerOpacityOf,
  layerShape,
  opacitySchema,
} from './fields/opacity.js';
export {
  LAYER_VISIBILITY_TYPES,
  isStoredHidden,
  visibilityShape,
  withoutStoredHidden,
} from './fields/visibility.js';
export { isCharacterBoundary } from './fields/character-boundary.js';
export * from './fields/text-api.js';
export {
  isSameColor,
  FONT_WEIGHTS,
  fontWeightSchema,
  isFontWeight,
  isSameTextStyle,
  languageTagSchema,
  postScriptNameSchema,
  restyledFace,
  withPostScriptName,
  type PostScriptName,
  LETTER_SPACING_LIMITS,
  letterSpacingSchema,
  fontFeaturesSchema,
  isSameFontFeatures,
  MAX_FONT_FEATURES,
  fontVariationAxesSchema,
  fontVariationsSchema,
  isSameFontVariations,
  mergeFontVariations,
  MAX_FONT_VARIATION_AXES,
  lineHeightSchema,
  MAX_FONT_SIZE,
  MAX_LINE_HEIGHT,
  MIN_FONT_SIZE,
  styleRunSchema,
  textStyleSchema,
} from './fields/text-style.js';
export type {
  FontFeatures,
  FontVariationAxes,
  FontVariations,
  FontWeight,
  LetterSpacing,
  LineHeight,
  PerUnit,
  StyleRun,
  TextStyle,
  ValueRange,
} from './fields/text-style.js';
export { objectToBoardTransform, parentToBoardTransform } from './geometry/board-transform.js';
export { placeConnectorEnds } from './geometry/connector-ends.js';
export type {
  ConnectorEndInput,
  ConnectorTargetBox,
  PlacedConnectorEnd,
  PlacedConnectorEnds,
} from './geometry/connector-ends.js';
// Connector and line geometry, moved from the engine so the vector export draws what it draws.
export * from './geometry/line-geometry-api.js';
export { croppedImageAspect, fittedImageRect, IMAGE_FIT_TOLERANCE } from './geometry/image-fit.js';
export type { FittedImage } from './geometry/image-fit.js';
export {
  imagePaintImageFrame,
  imagePaintLayout,
  imagePaintPointAt,
} from './geometry/image-paint-layout.js';
export type {
  ImagePaintLayout,
  ImagePaintMode,
  ImagePaintPoint,
  LaidOutImagePaint,
} from './geometry/image-paint-layout.js';
export { localBounds, pathBounds } from './geometry/local-bounds.js';
export { paintBoxOf, paintUnitPoint } from './geometry/paint-box.js';
export type { PaintedObject, UnitBoxPoint } from './geometry/paint-box.js';
export type { BoundsCache, Rect } from './geometry/local-bounds.js';
export {
  applyTransform,
  composeTransforms,
  invertTransform,
  placementTransform,
} from './geometry/rigid-transform.js';
export type { RigidTransform } from './geometry/rigid-transform.js';
export {
  boardTransformOf,
  boxOfPoints,
  EXTENT_NAMES,
  geometryBoxOf,
  geometryPointsOf,
  isBoxWithinBound,
  isFiniteBox,
  isFiniteTransform,
} from './geometry/world-box.js';
export type { ExtentBox, ExtentName } from './geometry/world-box.js';
export { assetIdSchema, type AssetId } from './ids/asset-id.js';
export { objectIdSchema, type ObjectId } from './ids/object-id.js';
export { isPageIdText, pageIdSchema } from './ids/page-id.js';
export type { PageId } from './ids/page-id.js';
export { principalIdSchema } from './ids/principal-id.js';
export type { PrincipalId } from './ids/principal-id.js';
export { createSeededIdGenerator } from './ids/seeded-id-generator.js';
export { MIGRATIONS, PRESET_GEOMETRY_SCHEMA_VERSION } from './migrations/migration-registry.js';
export type {
  MigrationRegistry,
  MigrationStep,
  VersionedDocumentJson,
} from './migrations/migration-step.js';
export { migrateToLatest, runMigrations } from './migrations/run-migrations.js';
export * from './objects/objects-api.js';
export {
  firstPageIdOf,
  isLivePage,
  orderedPagesOf,
  rootPageIdOf,
  shownPageIdOf,
  storedPageIdOf,
} from './pages/board-pages.js';
export {
  comparePages,
  DEFAULT_PAGE,
  DEFAULT_PAGE_ID,
  DEFAULT_PAGE_NAME,
  DEFAULT_PAGE_ORDER,
  MAX_PAGE_NAME_LENGTH,
  MAX_PAGES,
  pageSchema,
} from './pages/page.js';
export type { Page } from './pages/page.js';
export { BoardImportError } from './portable/board-import-error.js';
export { exportBoard } from './portable/export-board.js';
export {
  importBoard,
  importBoardInStages,
  type ImportStagesOptions,
} from './portable/import-board.js';
export {
  PORTABLE_BOARD_FORMAT,
  portableBoardSchema,
  portableTokenSchema,
} from './portable/portable-board.js';
export type { PortableBoardJson, PortableToken } from './portable/portable-board.js';
export { BOARD_ISSUE_CODES } from './rules/board-issue.js';
export type { BoardIssue, BoardIssueCode } from './rules/board-issue.js';
export { cascadeDelete } from './rules/cascade-delete.js';
export { detachedComments } from './rules/detach-comments.js';
export type {
  CascadeDeleteOptions,
  CascadeDeleteResult,
  ConnectorDeletePolicy,
} from './rules/cascade-delete.js';
export { collectDescendants } from './rules/collect-descendants.js';
export { detachCommentsFrom } from './rules/detach-comments.js';
export { detachConnectorsFrom } from './rules/detach-connectors.js';
export { detachAcrossPages } from './rules/detach-cross-page.js';
export type { PageOf } from './rules/detach-cross-page.js';
export { validateBoard } from './rules/validate-board.js';
export { findValueLimitIssues } from './rules/value-limits.js';
export type { ValueLimitIssue } from './rules/value-limits.js';
export {
  AUTO_LAYOUT_SCHEMA_VERSION,
  FRAME_RADIUS_VERSION,
  LAYER_OPACITY_VERSION,
  LAYER_VISIBILITY_VERSION,
  OBJECT_NAME_VERSION,
  SWAP_SCHEMA_VERSION,
  RUN_LANGUAGE_VERSION,
  POSTSCRIPT_NAME_VERSION,
  FRAME_PAINT_OVERRIDE_VERSION,
  FONT_FEATURES_VERSION,
  STICKY_ASPECT_VERSION,
  TEXT_DIRECTION_VERSION,
  TEXT_LISTS_SCHEMA_VERSION,
  FONT_VARIATIONS_VERSION,
  VARIANTS_SCHEMA_VERSION,
  isSupportedSchemaVersion,
  SCHEMA_VERSION,
} from './version/schema-version.js';
export {
  AUTO_LAYOUT_ALIGNS,
  AUTO_LAYOUT_DIRECTIONS,
  AUTO_LAYOUT_JUSTIFIES,
  AUTO_LAYOUT_SIZINGS,
  autoLayoutSchema,
  DEFAULT_AUTO_LAYOUT,
  layoutChildSchema,
} from './fields/auto-layout.js';
export type { AutoLayout, LayoutChild } from './fields/auto-layout.js';
export { layOutStack, stackLayoutOf } from './layout/stack-layout.js';
export type {
  StackAlign,
  StackDirection,
  StackJustify,
  StackLayout,
  StackNode,
  StackPadding,
  StackPlacement,
} from './layout/stack-layout.js';
export { compareKeys, compareSiblings, type SiblingKey } from './z-order/compare-keys.js';
export {
  BASE_62_DIGITS,
  isValidKey,
  isWellFormedKey,
  keyIntegerLength,
  MAX_KEY_LENGTH,
  SMALLEST_KEY_INTEGER,
} from './z-order/key-rule.js';
export { DRAFT_PREVIEW_Z } from './z-order/draft-key.js';
export { zKeySchema } from './z-order/z-key-schema.js';
export {
  decodeAtomicFrame,
  encodeAtomicFrame,
  isAtomicFrame,
  MAX_ATOMIC_PART_BYTES,
} from './relay/atomic-frame.js';
export type { AtomicFrame } from './relay/atomic-frame.js';
export { atomicHeaderSchema, type AtomicHeader } from './relay/atomic-header.js';

export { mapInsideObject, mapPoint, mapVector } from './geometry/affine-map.js';
export type { AffineMap } from './geometry/affine-map.js';
export { planGroupResize } from './geometry/group-resize.js';
export type {
  BoxSize,
  GroupResize,
  GroupResizePlan,
  ObjectTreeReader,
} from './geometry/group-resize.js';

export { importSvg } from './svg/svg-import.js';
export type {
  SvgImport,
  SvgImportedObject,
  SvgImportedPath,
  SvgImportedShape,
  SvgImportIssue,
  SvgImportOptions,
  SvgImportResult,
} from './svg/svg-import.js';
export { SVG_IMPORT_LIMITS } from './svg/svg-limits.js';
export { networkToPathData } from './svg/network-path-data.js';
export { PATH_DATA_MAX_LENGTH, pathDataToNetwork } from './svg/path-data-network.js';
export type { PathDataNetwork, PathDataPaint } from './svg/path-data-network.js';
export { readPathData, type PathData } from './svg/svg-path-data.js';
export { hasOpenSubpath, subpathsToNetwork } from './svg/svg-network.js';
export type { Network } from './svg/svg-network.js';
export { nonzeroDiffersFromEvenOdd } from './svg/svg-fill-rule.js';
export type { OutlinePiece, Subpath } from './svg/svg-geometry.js';
export { BOARD_MODES, type BoardMode } from './board/board-modes.js';
export * from './templates/templates-api.js';

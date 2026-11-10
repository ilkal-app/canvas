export {
  cameraClipTransform,
  isSameCamera,
  screenToWorld,
  visibleWorldBounds,
  worldToScreen,
} from './camera/camera.js';
export type { Camera, CameraClipTransform, WorldBounds } from './camera/camera.js';
export { clampZoom, MAX_ZOOM, MIN_ZOOM } from './camera/zoom-range.js';
export { DEFAULT_FRAME_HISTORY_CAPACITY, FrameHistory } from './diagnostics/frame-history.js';
export { FrameStatsRecorder } from './diagnostics/frame-stats-recorder.js';
export { FRAME_COUNTER_NAMES } from './diagnostics/frame-sample.js';
export type {
  FrameCounters,
  FrameSample,
  WritableFrameSample,
} from './diagnostics/frame-sample.js';
export { installStageTimers } from './diagnostics/install-stage-timers.js';
export type { StageTimersInstallation } from './diagnostics/install-stage-timers.js';
export {
  FRAME_TITLE_ATLAS_OWNER,
  GLYPH_ATLAS_OWNER,
  reportGlyphAtlasMemory,
} from './diagnostics/glyph-atlas-memory.js';
export { MEMORY_CATEGORIES, MemoryLedger } from './diagnostics/memory-ledger.js';
export type { MemoryCategory } from './diagnostics/memory-ledger.js';
export {
  budgetForDevice,
  DESKTOP_BUDGET_BYTES,
  MOBILE_BUDGET_BYTES,
} from './memory/device-budget.js';
export type { DeviceClass, DeviceDescription, DeviceMemoryBudget } from './memory/device-budget.js';
export { ATLAS_LOAN_MARGIN_SHARE, AtlasLoan, type AtlasLoanOptions } from './memory/atlas-loan.js';
export { EvictionMemory, REGENERATION_WINDOW_MS } from './memory/eviction-memory.js';
export { percentile, percentilePair, type PercentilePair } from './diagnostics/percentiles.js';
export {
  CAMERA_UNIFORM_OWNER,
  CLIP_TABLE_OWNER,
  reportSceneMemory,
} from './diagnostics/scene-memory.js';
export { DEFAULT_FRAME_BUDGET_MS, StageTimers } from './diagnostics/stage-timers.js';
export type { StageTimersOptions } from './diagnostics/stage-timers.js';
export { RECENT_FRAME_COUNT, type RecentFrame } from './diagnostics/recent-frames.js';
export { createBenchmarkSample } from './diagnostics/stats-export.js';
export type {
  BenchmarkSample,
  FrameWorkSummary,
  MemoryReading,
} from './diagnostics/stats-export.js';
export {
  connectorPathOf,
  CURVE_HANDLE_FRACTION,
  curvedConnectorCubic,
  ELBOW_STUB,
  elbowConnectorRoute,
} from './connectors/connector-path.js';
export type { ConnectorPath } from './connectors/connector-path.js';
export { connectorLabelPoint } from './connectors/connector-label.js';
export { resolveConnectorEnds, resolveConnectorShape } from './connectors/connector-placement.js';
export {
  connectorLabelSize,
  LABEL_GAP_PADDING,
  type ConnectorLabelSize,
} from './connectors/connector-mesh.js';
export type { LineGap } from './paths/line-gap.js';
export { ConnectorPlacements } from './connectors/connector-placements.js';
export type { ConnectorTargetSource } from './connectors/connector-placement.js';
export { connectorShapeOf, type ConnectorShape } from './connectors/connector-shape.js';
export { CONNECTOR_LEVEL_OF_DETAIL } from './connectors/connector-detail.js';
export { DrawableGate } from './drawable/drawable-gate.js';
export {
  DRAWABLE_EXTENT,
  MAX_DRAWABLE_SIZE,
  MAX_REPORTED_UNDRAWABLE,
} from './drawable/drawable-extent.js';
export type {
  UndrawableObject,
  UndrawableReason,
  UndrawableReport,
} from './drawable/drawable-extent.js';
export { ownUndrawableReason } from './drawable/drawable-fields.js';
export { isDrawableIn, undrawableReasonOf } from './drawable/drawable-geometry.js';
export * from './capture/capture-api.js';
export * from './gpu/gpu-api.js';
export * from './host/host-api.js';
export * from './highlight/highlight-api.js';
export * from './images/images-api.js';
export {
  BUILT_IN_STAGE_NAMES,
  COLLECT_CHANGES_STAGE,
  createCullStage,
  createDrawStage,
  SUBMIT_STAGE,
  UPLOAD_DIRTY_RANGES_STAGE,
} from './scene/built-in-stages.js';
export {
  CAMERA_UNIFORM_BYTE_LENGTH,
  CameraUniform,
  cameraUniformValues,
} from './scene/camera-uniform.js';
export { coalesceDirtyRecords, type ByteRange } from './scene/dirty-ranges.js';
export type { DrawListEntry } from './scene/draw-list.js';
export type { DrawStageBackground } from './scene/draw-stage-background.js';
export { Frame, type StagePosition } from './scene/frame.js';
export { NO_FRAME_TIMERS } from './scene/frame-context.js';
export { LAYER_COMPOSITE_PASS } from './scene/layers/layer-composite-pass.js';
export { LAYER_COMPOSITE_PASS_NAME } from './scene/layers/layer-composite-pass-name.js';
export type { LayerDraw } from './scene/layers/layer-draw.js';
export { isLayerForm } from './scene/layers/layer-form.js';
export { LAYERS_STAGE_NAME } from './scene/layers/layers-stage.js';
export type {
  FrameContext,
  FrameStage,
  FrameStats,
  FrameTimerHook,
} from './scene/frame-context.js';
export {
  dotGridUniformOf,
  GRID_DOT_COLOR,
  GRID_DOT_RADIUS_PX,
  GRID_UNIFORM_BYTE_LENGTH,
  GridBackground,
} from './scene/grid-background.js';
export type { GridBackgroundOptions } from './scene/grid-background.js';
export { GRID_FADE_FULL_ZOOM, GRID_FADE_HIDDEN_ZOOM, gridOpacityAt } from './scene/grid-fade.js';
export { GRID_MAX_SPACING_PX, GRID_MIN_SPACING_PX, gridSpacingAt } from './scene/grid-spacing.js';
export { InstanceBuffer, type InstanceBufferOptions } from './scene/instance-buffer.js';
export { splitRangesByPage } from './scene/page-split.js';
export type { PageRanges } from './scene/page-split.js';
export {
  CLIP_INDEX_LOCATION,
  resolveInstanceLayout,
  resolveSceneInstanceLayout,
} from './scene/instance-layout.js';
export { CLIP_FLOATS_PER_SLOT, CLIP_TEXELS_PER_SLOT, ClipTable } from './scene/clip-table.js';
export { CLIP_TABLE_BINDING, ClipTableTexture } from './scene/clip-table-texture.js';
export type { InstanceLayout } from './scene/instance-layout.js';
export { Scene } from './scene/scene.js';
export type { SceneHandles } from './scene/scene-handles.js';
export type { SceneOptions } from './scene/scene.js';
export type { SceneLayerOpacity } from './scene/scene-layer-fallbacks.js';
export { SceneHierarchy } from './scene/scene-hierarchy.js';
export { SceneChangeQueue } from './scene/scene-change-queue.js';
export { AllVisibleCuller } from './scene/scene-culler.js';
export type { CullRangeChange, InstanceRange, SceneCuller } from './scene/scene-culler.js';
export { resolveScenePasses } from './scene/scene-pass.js';
export type {
  SceneObject,
  ScenePass,
  ScenePassEntry,
  ScenePassEnvironment,
  ScenePassFactory,
  ScenePipelineSpec,
} from './scene/scene-pass.js';
export type {
  DrawerMemory,
  EntryDrawContext,
  ScenePassDrawer,
  ScenePassDrawerSetup,
} from './scene/scene-pass-drawer.js';
export { ScenePassResources } from './scene/scene-pass-resources.js';
export { SceneRenderer } from './scene/scene-renderer.js';
export type { FrameInput, InkColors, SceneRendererOptions } from './scene/scene-renderer.js';
export { DEFAULT_CHURN_BUDGET } from './scene/scene-renderer-options.js';
export type { ChurnBudget } from './scene/scene-renderer-options.js';
export type { SceneChangeSet, SceneSource } from './scene/scene-source.js';
export { ColorTargets, colorOptionsOf } from './scene/color-targets.js';
export type { ColorTargetsOptions } from './scene/color-targets.js';
export { FRAME_FILL_LUMINANCE, isFrameFillFallback } from './scene/color-mode-fallback.js';
export type {
  ColorModeFallbackName,
  ColorModeFallbackOption,
} from './scene/color-mode-fallback.js';
export { paintOrderOf } from './scene/segments/paint-order.js';
export type { StackedObject } from './scene/segments/paint-order.js';
export { planSegmentDraws, planSegments } from './scene/segments/segment-plan.js';
export type {
  PlannedPass,
  SegmentPlan,
  SegmentPlanInput,
  SlotOwners,
} from './scene/segments/segment-plan.js';
export type { PassPageSpans } from './scene/segments/segment-pages.js';
export { compareStacking, type StackingKey } from './scene/segments/stacking-order.js';
export type { BoundsOfRank } from './scene/segments/segment-groups.js';
export type { SegmentSpatialIndex } from './scene/segments/segment-moves.js';
export {
  DEFAULT_SLOT_COMPACTION,
  MAX_CHECKED_MOVES,
  PAINT_ORDER_BATCH,
  Z_ORDER_SEGMENTS_STAGE_NAME,
  ZOrderSegments,
} from './scene/segments/z-order-segments.js';
export type {
  SegmentRemovalCounts,
  ZOrderSegmentCounts,
  ZOrderSegmentsOptions,
  ZOrderTables,
} from './scene/segments/z-order-segments.js';
export type { SlotCompactionOptions } from './scene/segments/slot-compactor.js';
export { RECT_GRADIENT_PASS, RECT_GRADIENT_PASS_NAME } from './scene/rect-gradient-pass.js';
export { RECT_IMAGE_PASS, RECT_IMAGE_PASS_NAME } from './scene/rect-image-pass.js';
export { ROUNDED_RECT_GRADIENT_PASS, ROUNDED_RECT_PASS } from './scene/rounded-rect-pass.js';
export { isInsideFrameShape } from './spatial/frame-hit.js';
export { SOLID_RECT_PASS } from './scene/solid-rect-pass.js';
export { FRAME_SHADOW_PASS, FRAME_SHADOW_PASS_NAME } from './scene/frame-shadow-pass.js';
export { FRAME_STROKE_PASS, FRAME_STROKE_PASS_NAME } from './scene/frame-stroke-pass.js';
export { isStrokedFrame, writeFrameStrokeRecord } from './scene/frame-stroke-pass.js';
export {
  IMAGE_BORDER_PASS,
  IMAGE_BORDER_PASS_NAME,
  isBorderedImage,
  writeImageBorderRecord,
} from './scene/image-border-pass.js';
export { createStandardScenePasses } from './scene/standard-passes.js';
export type { StandardScenePassesOptions } from './scene/standard-passes.js';
export { worldTransformOf } from './scene/world-transform.js';
export type { WorldTransform } from './scene/world-transform.js';
export { packShapeCamera, SHAPE_CAMERA_BYTE_LENGTH } from './shapes/shape-camera.js';
export type { ShapeCamera } from './shapes/shape-camera.js';
export {
  ellipseDistance,
  polygonDistance,
  polygonFitOf,
  roundedBoxDistance,
  shapeDistance,
  STAR_INNER_SCALE,
  starInnerRadius,
  unitPolygonInradius,
  unitPolygonVertex,
} from './shapes/shape-distance.js';
export type { PolygonFit, ShapeVector } from './shapes/shape-distance.js';
export type {
  ShapeColor,
  ShapeInstance,
  ShapeKind,
  ShapeRect,
  ShapeStroke,
} from './shapes/shape-instance.js';
export {
  packShapeInstances,
  SHAPE_INSTANCE_BYTES,
  SHAPE_FLAT_KIND_CODE,
  SHAPE_INSTANCE_FLOATS,
  SHAPE_KIND_CODES,
  SHAPE_UNCLIPPED_QUAD_VERTEX_LAYOUT,
  SHAPE_VERTEX_BUFFERS,
} from './shapes/shape-instance-layout.js';
export {
  SHAPE_BINDINGS,
  SHAPE_PIPELINE_DESCRIPTOR,
  SHAPE_QUAD_CORNERS,
  SHAPE_QUAD_VERTEX_COUNT,
  SHAPE_UNCLIPPED_QUAD_VERTICES,
} from './shapes/shape-pipeline.js';
export {
  isOutlineVisible,
  isPaintedShape,
  isPaintedShapeObject,
  SHAPE_KIND_OF,
  writeShapeRecord,
} from './shapes/shape-object-record.js';
export {
  SDF_SHAPE_GRADIENT_PASS,
  SDF_SHAPE_GRADIENT_PASS_NAME,
  SHAPE_GRADIENT_INSTANCE_LAYOUT,
} from './shapes/shape-gradient-pass.js';
export {
  IMAGE_FILL_PAGE_BINDINGS,
  SDF_SHAPE_IMAGE_PASS,
  SDF_SHAPE_IMAGE_PASS_NAME,
  SHAPE_IMAGE_INSTANCE_LAYOUT,
} from './shapes/shape-image-pass.js';
export {
  LINK_ICON_PASS,
  LINK_ICON_PASS_NAME,
  LINK_PREVIEW_PASS,
  LINK_PREVIEW_PASS_NAME,
} from './shapes/link-card-image-pass.js';
export { SHAPE_LEVEL_OF_DETAIL } from './shapes/shape-flat-form.js';
export { SDF_SHAPE_PASS, SDF_SHAPE_PASS_NAME } from './shapes/shape-pass.js';
export { ShapeRenderer } from './shapes/shape-renderer.js';
export type { ShapeInstanceRange } from './shapes/shape-renderer.js';
export { NOTE_CORNER_RADIUS, NOTE_SHADOW, noteInstances } from './shapes/sticky-note.js';
export {
  drawnShadowOf,
  drawnShadowsOf,
  readShadow,
  readShadowLayers,
  SHADOW_SOFTNESS_PER_BLUR,
  shadowMarginOf,
  shadowPlacementOf,
  shadowSilhouetteOf,
  writeObjectShadowRecord,
  writeShadowRecord,
} from './shapes/shape-shadow.js';
export type { ShadowSilhouette } from './shapes/shape-shadow.js';
export {
  clipBounds,
  clipChainOf,
  clipCoverageAt,
  clipRectOf,
  isInsideClipChain,
  MAX_CLIP_DEPTH,
} from './spatial/clip-chain.js';
export type { ClipChainMemo, ClipRect, OrientedBox } from './spatial/clip-chain.js';
export { DEFAULT_HIT_TOLERANCE_PX, hitPoint, hitTopmost } from './spatial/hit-point.js';
export type { HitPointOptions } from './spatial/hit-point.js';
export { hitPaletteOf, type HitColors } from './spatial/hit-palette.js';
export { hitRect, type HitRectMode } from './spatial/hit-rect.js';
export { sortTopmostFirst } from './spatial/paint-order.js';
export { worldBoundsOf } from './spatial/object-world-bounds.js';
export {
  createTraceTintLayer,
  TRACE_TINT_STAGE_NAME,
  TraceTintLayer,
} from './tint/trace-tint-layer.js';
export {
  EMPTY_TRACE_TINT,
  isTraceTintModel,
  TRACE_TINT_FILL_ALPHA,
  TRACE_TINT_HEADER_PX,
  TRACE_TINT_OUTLINE_PX,
  TRACE_TINT_PADDING_PX,
  traceTintRectsOf,
} from './tint/trace-tint-model.js';
export type { TraceTintModel, TraceTintRect, TraceTintSheet } from './tint/trace-tint-model.js';
export * from './peers/peers-api.js';
export type {
  PeerEditingBox,
  PeerEditingMark,
  PeerEditingModel,
  PeerEditingRect,
} from './peers/peer-editing-model.js';
export { RTree } from './spatial/r-tree.js';
export type { RTreeEntry, RTreeOptions } from './spatial/r-tree.js';
export { DrawingChangeLog } from './spatial/drawing-change-log.js';
export { SceneSpatialIndex } from './spatial/scene-spatial-index.js';
export type { IndexedBoxChange } from './spatial/scene-spatial-index.js';
export { SpatialCuller } from './spatial/spatial-culler.js';
export type { SpatialCullerOptions } from './spatial/spatial-culler.js';
export type { VisibilityChange } from './spatial/spatial-visibility.js';
export type { SpatialSearch } from './spatial/spatial-search.js';
export * from './lod/lod-api.js';
export * from './paint/paint-api.js';
export * from './paths/paths-api.js';
export * from './text/text-api.js';
export * from './workers/workers-api.js';

export { ImageLoadDeferredError } from './images/image-load-deferred.js';
export type { SegmentRangeChanges } from './scene/segments/segment-removals.js';
export type { LodVisibilityInput } from './lod/lod-visibility.js';

export type { SegmentWindowCounts } from './scene/segments/segment-windows.js';

export { TranslationChangeEncoder } from './host/translation-change-set.js';

export type { RetainedMoveCommand } from './host/retained-move-command.js';
export type { MovePlacementBinding } from './gpu/move-placement.js';
export type { TransformTable, TransformTablePlacement } from './gpu/transform-table.js';
export type { CertifiedPreviewResources } from './scene/scene-preview-resources.js';
export type { ScenePreviewResources } from './scene/scene-preview-resources.js';

export type {
  ImagePreviewEvidence,
  ImageObjectEvidence,
  ImageResidentEvidence,
} from './images/image-preview-evidence.js';
export type { ImageBinding, BindingPart, ImageSource, PageRegion } from './images/image-binding.js';
export type { ResidencyImage } from './images/residency-image.js';
export type { ObjectPlan } from './images/image-needs.js';
export type { UnitRect, TileAddress } from './images/tiles.js';
export { InstanceExpansion, isVirtualObjectId } from './components/instance-expansion.js';
export type { InstanceStatus } from './components/instance-expansion.js';
export type { DefinitionSource } from './components/definition-source.js';
export {
  centredCamera,
  type BenchPoint,
  ZOOM_SWEEP,
  zoomSweepLegs,
  type CameraLeg,
  type CameraViewport,
  type ZoomSweep,
} from './diagnostics/bench/zoom-sweep.js';
export {
  isInsideBand,
  LOD_WOBBLES,
  lodWobbleDurationMs,
  lodWobbleLegs,
  WOBBLE_SWINGS,
  type LodWobble,
} from './diagnostics/bench/lod-wobble.js';
export { dragPath, type DragPathOptions, type TimedPoint } from './diagnostics/bench/drag-path.js';
export { TYPED_TEXT, typingTimeline, type TypedKey } from './diagnostics/bench/typing-input.js';

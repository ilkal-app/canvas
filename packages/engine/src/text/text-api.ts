// The text area's public API (MSDF text: fonts, layout, glyph atlases, the text renderer),
// re-exported by the package entry, src/index.ts, which would otherwise pass 400 lines.
export type { AtlasUpload } from './atlas/atlas-upload.js';
export {
  DEFAULT_ATLAS_BUDGET_BYTES,
  DEFAULT_ATLAS_PAGE_SIZE,
  GLYPH_ATLAS_GUTTER,
  GlyphAtlas,
} from './atlas/glyph-atlas.js';
export {
  createTextAtlas,
  FRAME_TITLE_ATLAS_SHARE,
  LINK_CARD_TEXT_ATLAS_SHARE,
  STICKY_AUTHOR_ATLAS_SHARE,
  glyphAtlasSizing,
  TEXT_ATLAS_SHARE,
  textAtlasOptions,
} from './atlas/glyph-atlas-sizing.js';
export type { GlyphAtlasSizing } from './atlas/glyph-atlas-sizing.js';
export { cappedTier, glyphCellSide, maxTierForPage } from './atlas/glyph-cell.js';
export type {
  AtlasGlyph,
  AtlasMemoryReport,
  AtlasPage,
  GlyphAtlasOptions,
} from './atlas/glyph-atlas.js';
export { DISTANCE_RANGE_PX, GLYPH_PADDING_PX } from './atlas/glyph-bitmap.js';
export type { GlyphBitmap, GlyphField } from './atlas/glyph-bitmap.js';
export {
  atlasTierOf,
  BASE_TIER,
  GLYPH_TIERS,
  HIGH_TIER,
  lowerTiers,
  MAX_TIER,
  pickAvailable,
  pickTextTier,
  pickTier,
  TIER_HYSTERESIS,
  VECTOR_TIER,
} from './atlas/glyph-tiers.js';
export type { AvailableEntry, GlyphTier, TextTier, TextTierOptions } from './atlas/glyph-tiers.js';
export { ShelfAllocator } from './atlas/shelf-allocator.js';
export type { ShelfAllocation } from './atlas/shelf-allocator.js';
export { fontFaceId, fontFaceOf, isCoverageFamily, resolveFontFace } from '@canvas/text';
export type { FontFaceKey } from '@canvas/text';
export { FontFormatError } from '@canvas/text';
export { loadShaper } from '@canvas/text';
export type { Shaper } from '@canvas/text';
export { FontLibrary } from './font/font-library.js';
export type { LoadedFontFace } from './font/font-library.js';
export { createFontMetrics, FontMetricsLookup, subsetFontMetrics } from '@canvas/text';
export type { FontMetrics } from '@canvas/text';
export type {
  CubicSegment,
  GlyphOutline,
  LineSegment,
  OutlineContour,
  OutlineSegment,
  QuadraticSegment,
} from '@canvas/text';
export { parseFont } from '@canvas/text';
export type { ParsedFont } from '@canvas/text';
export {
  caretPlacement,
  caretRect,
  hitTest,
  indexAtLine,
  lineAtY,
  lineEndIndex,
  lineOf,
  selectionSpans,
  visualCaretStep,
} from './layout/caret.js';
export type { CaretPlacement, SelectionSpan } from './layout/caret.js';
export { createMetricsMeasurer } from '@canvas/text';
export type { GlyphMeasurer, LineMetrics } from '@canvas/text';
export { layoutJob, layoutTextNow, requestLayout } from './layout/layout-job.js';
export type { LayoutTicket } from './layout/layout-job.js';
export type {
  LayoutJobFace,
  LayoutJobRequest,
  LayoutJobResponse,
} from './layout/layout-job-payload.js';
export { createLayoutJobRequest } from './layout/layout-request.js';
export { libraryShaping, type LayoutShaping } from './layout/layout-shaping.js';
export {
  COVERAGE_FLATTENING_TOLERANCE_PX,
  coverageToImage,
  rasterizeCoverage,
  type CoverageImage,
  type CoverageImageOptions,
  type CoverageRasterOptions,
  type PlacedOutline,
} from './raster/coverage-raster.js';
export { isLayoutShaperLoaded, preloadLayoutShaper } from './layout/layout-job.js';
export type { LayoutInput } from './layout/layout-request.js';
export { layoutText } from '@canvas/text';
export { lineExtent } from '@canvas/text';
export { packTextLayout, unpackTextLayout } from './layout/packed-layout.js';
export type { PackedTextLayout } from './layout/packed-layout.js';
export { LINE_HEIGHT_EM } from '@canvas/text';
export type {
  CaretRect,
  LayoutGlyph,
  LayoutLine,
  LayoutRun,
  LineExtent,
  TextAlign,
  TextBaseDirection,
  TextLayout,
} from '@canvas/text';
export {
  glyphFaceOf,
  glyphIdOfKey,
  glyphKeyOf,
  type GlyphFace,
  type GlyphKey,
} from './atlas/glyph-key.js';
export { MAX_BATCH_SIDE_PX, planGlyphBatches } from './msdf/glyph-batches.js';
export { GlyphSource } from './msdf/glyph-source.js';
export type { GlyphSourceOptions, MsdfJobSubmitter } from './msdf/glyph-source.js';
export { generateMsdfGlyph, loadMsdfgenFont } from './msdf/msdf-generator.js';
export { createMsdfJobHandler } from './msdf/msdf-job.js';
export type { MsdfJobHandlerOptions } from './msdf/msdf-job.js';
export type {
  ColourCanvas,
  ColourCanvasFactory,
  ColourContext2d,
  ColourGradient,
  ColourImage,
  ColourMatrix,
  ColourPixels,
} from './colour/colour-canvas.js';
export type { GeneratedGlyph, MsdfJobRequest, MsdfJobResponse } from './msdf/msdf-job-payload.js';
export type {
  MsdfgenBitmap,
  MsdfgenByteVector,
  MsdfgenByteVectorClass,
  MsdfgenFont,
  MsdfgenFontClass,
  MsdfgenGlyphShape,
  MsdfgenModule,
  MsdfgenModuleLoader,
} from './msdf/msdfgen-module.js';
export { rasterizeSdfGlyph } from './msdf/sdf-rasterizer.js';
export {
  GLYPH_INSTANCE_BYTES,
  GLYPH_INSTANCE_LAYOUT,
  GLYPH_QUAD_CORNERS,
  GLYPH_QUAD_VERTEX_COUNT,
  GLYPH_QUAD_VERTEX_LAYOUT,
  writeGlyphInstance,
} from './renderer/glyph-instance.js';
export type { GlyphQuad } from './renderer/glyph-instance.js';
export { GlyphInstanceBatch } from './renderer/glyph-instance-batch.js';
export type { GlyphInstanceRange, GlyphSpan } from './renderer/glyph-instance-batch.js';
export { buildGlyphQuads } from './renderer/glyph-quads.js';
export type { GlyphPlacement, GlyphQuads, GlyphRequester } from './renderer/glyph-quads.js';
export {
  TEXT_BINDINGS,
  TEXT_PAGE_TEXTURE_BINDINGS,
  TEXT_PAGE_UNIFORM_BYTES,
  TEXT_PAGES_PER_GROUP,
  TEXT_PIPELINE_DESCRIPTOR,
  textPageUniform,
} from './renderer/text-pipeline.js';
export { TextRenderer } from './renderer/text-renderer.js';
export { orderedGlyphQuads } from './scene/ordered-glyph-quads.js';
export type {
  GlyphLookupCounts,
  OrderedGlyphQuads,
  PagedGlyphQuad,
  VectorGlyphPolicy,
} from './scene/ordered-glyph-quads.js';
export {
  TEXT_BEGIN_STAGE_NAME,
  TEXT_PASS,
  TEXT_PASS_NAME,
  TEXT_REFRESH_STAGE_NAME,
  textRecordCount,
} from './scene/text-pass.js';
export type { FontFaceSource, TextPassResources } from './scene/text-pass-resources.js';
export type { TextPassKind } from './scene/text-pass-definition.js';
export type { TextObjectEntry } from './scene/text-object-entry.js';
export { TEXT_VECTOR_PASS, TEXT_VECTOR_PASS_NAME } from './scene/text-vector-pass.js';
export {
  FRAME_TITLE_BAND_PX,
  FRAME_TITLE_FONT_PX,
  FRAME_TITLE_STYLE,
  frameTitlePlacement,
} from './scene/frame-title-box.js';
export {
  FRAME_TITLE_LEVEL_OF_DETAIL,
  FRAME_TITLE_PASS,
  FRAME_TITLE_PASS_NAME,
} from './scene/frame-title-pass.js';
export {
  NO_STICKY_AUTHORS,
  STICKY_AUTHOR_MAX_CHARS,
  STICKY_AUTHOR_STYLE,
  stickyAuthorPlacement,
  stickyAuthorTextOf,
} from './scene/sticky-author-box.js';
export type { StickyAuthors } from './scene/sticky-author-box.js';
export { linkCardBodyPlacement, linkCardFooterPlacement } from './scene/link-card-text-box.js';
export {
  LINK_CARD_BODY_PASS,
  LINK_CARD_BODY_PASS_KIND,
  LINK_CARD_BODY_PASS_NAME,
  LINK_CARD_FOOTER_PASS,
  LINK_CARD_FOOTER_PASS_KIND,
  LINK_CARD_FOOTER_PASS_NAME,
} from './scene/link-card-text-pass.js';
export {
  STICKY_AUTHOR_LEVEL_OF_DETAIL,
  STICKY_AUTHOR_PASS,
  STICKY_AUTHOR_PASS_KIND,
  STICKY_AUTHOR_PASS_NAME,
} from './scene/sticky-author-pass.js';
export {
  NOTE_FIT_FLOOR_PX,
  NOTE_PADDING,
  fitNoteText,
  fittedNoteHeight,
  noteBoxHeight,
  noteHeightFor,
  noteMinHeight,
  noteTextPlacement,
  noteWrapWidth,
  type NoteFit,
  type NoteFitInput,
  type NoteFitLayout,
} from './scene/note-text-box.js';
export {
  LABEL_PADDING,
  LABEL_PADDING_FRACTION,
  labelPaddingOf,
  shapeLabelBox,
  shapeLabelPlacement,
} from './scene/shape-label-box.js';
export type { ShapeLabelRect } from './scene/shape-label-box.js';
export {
  CONNECTOR_LABEL_WRAP_WIDTH,
  connectorLabelPlacement,
} from './scene/connector-label-box.js';
export { TEXT_LEVEL_OF_DETAIL, textLineHeightOf } from './scene/text-detail.js';
export { GREEK_ALPHA, GREEK_PAGE_RECT, greekQuads, isGreekQuad } from './scene/greek-quads.js';
export { textOriginOf, textPlacementOf } from './scene/text-placement.js';
export type { TextBoxGeometry, TextVerticalAlign } from './scene/text-placement.js';
export { TEXT_RECORD_LAYOUT } from './scene/text-record.js';
export {
  cubicToQuadratics,
  DEFAULT_CUBIC_TOLERANCE_EM,
  GlyphGeometryCache,
  tessellateGlyph,
} from './vector/glyph-geometry.js';
export type { GlyphBounds, GlyphGeometry, GlyphQuadratic } from './vector/glyph-geometry.js';
export { EDGE_FLOATS_PER_VERTEX, glyphEdgeMesh } from './vector/glyph-edge-mesh.js';
export type { GlyphEdgeMesh } from './vector/glyph-edge-mesh.js';
export { glyphEdges } from './vector/glyph-edges.js';
export type { GlyphEdge, GlyphEdgeOptions } from './vector/glyph-edges.js';
export { createGlyphGeometryJobHandler } from './vector/glyph-geometry-job.js';
export type {
  GlyphGeometryJobGlyph,
  GlyphGeometryJobRequest,
  GlyphGeometryJobResponse,
} from './vector/glyph-geometry-job-payload.js';
export {
  DEFAULT_GLYPH_GEOMETRY_BUDGET_BYTES,
  MAX_GLYPH_GEOMETRY_BATCH,
  VectorGlyphSource,
} from './vector/vector-glyph-source.js';
export type {
  GlyphGeometryJobSubmitter,
  VectorGlyphSourceOptions,
} from './vector/vector-glyph-source.js';
export { buildVectorRunMesh, glyphGeometryKey } from './vector/vector-run-mesh.js';
export {
  createVectorTextPipelines,
  destroyVectorTextPipelines,
  GLYPH_EDGE_VERTEX_LAYOUT,
  GLYPH_STENCIL_VERTEX_LAYOUT,
  VECTOR_CLEANUP_STATE,
  VECTOR_COVER_STATE,
  VECTOR_COVER_VERTEX_LAYOUT,
  VECTOR_EDGE_STATE,
  VECTOR_STENCIL_STATE,
  vectorCoverQuad,
} from './vector/vector-text-pipelines.js';
export type { VectorTextPipelines } from './vector/vector-text-pipelines.js';
export type {
  GlyphGeometryLookup,
  VectorRunMesh,
  VectorRunMeshResult,
} from './vector/vector-run-mesh.js';

export { fallbackFamily, SYMBOL_COVERAGE_FAMILIES, symbolCoverageFamilies } from '@canvas/text';
export {
  cjkSliceFace,
  COVERAGE_FONT_FILES,
  coverageNeeds,
  type CoverageNeed,
  fallbackFamiliesOf,
  scriptCoverageFamilies,
  scriptOf,
  serverCoverageFamilies,
} from '@canvas/text';
export type { MissingGlyph } from '@canvas/text';
export { missingCoverageGlyphs } from './font/coverage-runs.js';

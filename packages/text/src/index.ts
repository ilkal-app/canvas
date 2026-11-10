// @canvas/text: font parsing, font metrics and text layout, pure and DOM-free, so the renderer
// and the agent surface measure text the same way.
export { fallbackFamily } from './font/fallback-family.js';
export { fontFaceId, fontFaceOf, nearestWeights, resolveFontFace } from './font/font-face.js';
export type { FontFaceKey } from './font/font-face.js';
export { collectionFaceCount, extractFace, postScriptNamesOf } from './font/font-collection.js';
export { decodeWebFont, MAX_DECODED_FONT_BYTES, webFontFormatOf } from './font/web-font.js';
export { FontFormatError } from './font/font-format-error.js';
export { createFontMetrics, FontMetricsLookup, subsetFontMetrics } from './font/font-metrics.js';
export type { FontMetrics } from './font/font-metrics.js';
export type {
  CubicSegment,
  GlyphOutline,
  LineSegment,
  OutlineContour,
  OutlineSegment,
  QuadraticSegment,
} from './font/glyph-outline.js';
export { parseFont } from './font/parse-font.js';
export type { ParsedFont } from './font/parse-font.js';
export { codepointAt, NEWLINE, SPACE } from './layout/codepoints.js';
export type { StringCharacter } from './layout/codepoints.js';
export { createMetricsMeasurer } from './layout/glyph-measurer.js';
export type { GlyphMeasurer, LineMetrics } from './layout/glyph-measurer.js';
export { BASE_COLOR, readInkable } from './layout/inkable-color.js';
export { layoutText } from './layout/layout-text.js';
export {
  LIST_INDENT_EM,
  listMarkerOf,
  listOrdinalsOf,
  MARKER_GAP_EM,
} from './layout/list-markers.js';
export type { DecorationMetrics } from './font/decoration-metrics.js';
export {
  loadShaper,
  MAX_SHAPER_FACE_BYTES,
  MAX_VARIATION_INSTANCES,
  shapeText,
  SHAPER_VERSION,
} from './shaping/shaper.js';
export type { ShapedGlyph, ShapedRun, Shaper, ShapingFace } from './shaping/shaper.js';
export { COLOUR_GLYPH_COMPOSITES } from './shaping/colour-glyph.js';
export type {
  ColourGlyphComposite,
  ColourGlyphExtend,
  ColourGlyphImage,
  ColourGlyphLinear,
  ColourGlyphOp,
  ColourGlyphPopClip,
  ColourGlyphPopGroup,
  ColourGlyphPopTransform,
  ColourGlyphPushClipGlyph,
  ColourGlyphPushClipRect,
  ColourGlyphPushGroup,
  ColourGlyphPushTransform,
  ColourGlyphRadial,
  ColourGlyphSolid,
  ColourGlyphSweep,
  ColourGlyphOptions,
  ColourGlyphProgram,
  ColourGlyphRgba,
  ColourGlyphSource,
  ColourGlyphStop,
} from './shaping/colour-glyph.js';
export { createShapingMeasurer } from './shaping/shaping-measurer.js';
export type { ShapingFont } from './shaping/shaping-measurer.js';
export { guessDirection } from './shaping/text-direction.js';
export { lineBreakOpportunities } from './line-break/line-breaks.js';
export type { LineBreakOpportunity, LineBreakOptions } from './line-break/line-breaks.js';
export { eastAsianWidthOf, lineBreakClassOf } from './line-break/line-break-class.js';
export { LINE_BREAK_CLASSES } from './line-break/line-break-class.js';
export type { LineBreakClass } from './line-break/line-break-class.js';
export { LINE_BREAKING_VERSION } from './line-break/line-break-version.js';
export {
  BIDI_CLASSES,
  bidiClassOf,
  mirroredCodepointOf,
  pairedBracketOf,
} from './bidi/bidi-class.js';
export type { BidiClass, PairedBracket } from './bidi/bidi-class.js';
export { lineLevels, resolveParagraphLevels, visualOrder } from './bidi/bidi-levels.js';
export type { BidiParagraphLevels, ParagraphDirection } from './bidi/bidi-levels.js';
export { splitParagraphs } from './bidi/split-paragraphs.js';
export type { ParagraphRange } from './bidi/split-paragraphs.js';
export type { TextDirection } from './shaping/text-direction.js';
export { lineExtent } from './layout/line-metrics.js';
export { LINE_HEIGHT_EM } from './layout/text-layout.js';
export { autoDirectionOf } from './layout/text-bidi.js';
export type {
  CaretRect,
  LayoutDecoration,
  LayoutGlyph,
  LayoutLine,
  LayoutMarker,
  LayoutRun,
  LineExtent,
  TextAlign,
  TextBaseDirection,
  TextLayout,
} from './layout/text-layout.js';
export {
  CONNECTOR_LABEL_WRAP_WIDTH,
  NOTE_PADDING,
  noteBoxHeight,
  noteHeightFor,
  noteMinHeight,
  noteWrapWidth,
} from './box/text-boxes.js';
export {
  NOTE_FIT_FLOOR_PX,
  fitNoteText,
  fittedNoteHeight,
  type NoteFit,
  type NoteFitInput,
  type NoteFitLayout,
} from './box/note-fit.js';
export {
  polygonFitOf,
  STAR_INNER_SCALE,
  starInnerRadius,
  unitPolygonInradius,
  unitPolygonVertex,
} from './box/polygon-fit.js';
export type { PolygonFit, ShapeVector } from './box/polygon-fit.js';
export {
  LABEL_PADDING,
  LABEL_PADDING_FRACTION,
  labelPaddingOf,
  shapeLabelBox,
  shapeLabelWrapWidth,
} from './box/shape-label-box.js';
export type { ShapeLabelGeometry, ShapeLabelRect } from './box/shape-label-box.js';
export {
  connectorLabelPlacementAt,
  noteTextPlacement,
  shapeLabelPlacement,
  textOriginOf,
  textPlacementOf,
} from './box/text-placement.js';
export type {
  ConnectorLabelPointOf,
  TextBoxGeometry,
  TextVerticalAlign,
} from './box/text-placement.js';
export {
  BUNDLED_FONT_CATALOGUE,
  BUNDLED_FONT_FAMILIES,
  DEFAULT_FONT_FAMILY,
  bundledFamilyMetrics,
} from './bundled/bundled-fonts.js';
export type { BundledFontFace, BundledFontFamily } from './bundled/bundled-fonts.js';
export { FONT_CATEGORIES } from './bundled/encoded-family.js';
export type { FontCategory } from './bundled/encoded-family.js';
export { clampLines, LINE_CLAMP_ELLIPSIS } from './box/line-clamp.js';
export type { LineClamp, LineClampLayout } from './box/line-clamp.js';
export { MIN_TEXT_BOX_SIZE, measureObjectText } from './measure/measure-object.js';
export type {
  MeasurableConnector,
  MeasurableNote,
  MeasurableShape,
  MeasurableObject,
  MeasurableTextObject,
  ObjectTextMeasurement,
  TextBoxSize,
} from './measure/measure-object.js';
export { measuringFontsFor, measureText } from './measure/measure-text.js';
export { prepareMeasuringFonts } from './measure/prepare-measuring-fonts.js';
export { createTextShaping, MissingFontFileError } from './measure/text-shaping.js';
export { shapeWithMetrics } from './shaping/metrics-shaping.js';
export type { TableFontMetrics } from './shaping/metrics-shaping.js';
export type {
  SyncFontBytesSource,
  TextShaping,
  TextShapingOptions,
} from './measure/text-shaping.js';
export type { FontBytesSource, PreparedMeasuringFonts } from './measure/prepare-measuring-fonts.js';
export { bundledFontFile, bundledFontFilePaths } from './bundled/bundled-font-file.js';
export {
  COVERAGE_FONT_FILES,
  coverageFontFile,
  serverCoverageFamilies,
  serverCoverageFontFilePaths,
} from './bundled/coverage-font-file.js';
export { expandedGlyphsOf } from './bundled/expanded-glyphs.js';
export type { BundledFontFile } from './bundled/bundled-font-file.js';
export { measureOverrideText, type OverrideMeasurement } from './measure/measure-override.js';
export {
  coverageMeasureRuns,
  missingClusterGlyphs,
  missingGlyphs,
} from './measure/glyph-coverage.js';
export { fallbackRuns } from './measure/fallback-runs.js';
export { isCoverageFamily } from './symbols/coverage-family.js';
export type { FallbackFace } from './measure/fallback-runs.js';
export { clusterScript } from './script/cluster-script.js';
export {
  EMOJI_FAMILY,
  fallbackFamiliesOf,
  HAN_LANGUAGE_FAMILIES,
} from './script/fallback-families.js';
export { isEmojiPresentation } from './script/emoji-presentation.js';
export { SCRIPT_CODES, scriptExtensionsOf, scriptOf } from './script/script-table.js';
export type { ScriptCode } from './script/script-table.js';
export type { MissingGlyph } from './measure/glyph-coverage.js';
export { symbolCoverageMetrics } from './bundled/coverage-fonts.js';
export { BUNDLED_FONTS_FINGERPRINT } from './bundled/fonts-fingerprint.js';
export * from './slices/slices-api.js';
export { SYMBOL_COVERAGE_FAMILIES, symbolCoverageFamilies } from './symbols/symbol-coverage.js';
export {
  hasScriptCoverage,
  SCRIPT_COVERAGE_FAMILIES,
  scriptCoverageFamilies,
} from './symbols/script-coverage.js';
export type {
  CoverageMeasuring,
  MeasuringFonts,
  TextBoxDirection,
  TextMeasurement,
  UnknownFamily,
  WeightFallback,
} from './measure/measure-text.js';
export { readVariationAxes } from './variation/fvar.js';
export type { NamedInstance, VariationAxes, VariationAxis } from './variation/fvar.js';
export { normaliseVariations, VARIATION_STEP } from './variation/normalise-variations.js';
export { variationKey } from './variation/variation-key.js';
export {
  composeAffine,
  formatNumber,
  glyphPathData,
  glyphPdfPath,
  glyphTransform,
  IDENTITY_AFFINE,
} from './export/glyph-path-data.js';
export type { Affine } from './export/glyph-path-data.js';
export { textVectors } from './export/text-vectors.js';
export type {
  ImageVectorGlyph,
  LayersVectorGlyph,
  OutlineVectorGlyph,
  VectorCluster,
  VectorGlyph,
  VectorGlyphSource,
} from './export/text-vectors.js';
export { colourLayers } from './export/colour-layers.js';
export type {
  ColourLayers,
  VectorFill,
  VectorGradient,
  VectorGradientStop,
  VectorImage,
  VectorGroup,
  VectorLayer,
  VectorLinearGradient,
  VectorRadialGradient,
  VectorRegion,
  VectorSweepGradient,
} from './export/colour-layers.js';
export { fsTypeOf } from './export/fs-type.js';
export type { FontEmbedding } from './export/fs-type.js';
export { textSvg } from './export/text-svg.js';
export type {
  EmbeddedFontFile,
  SelectableTextOptions,
  TextSvg,
  TextSvgOptions,
} from './export/text-svg.js';
export { svgDocument } from './export/svg-document.js';
export { base64Of } from './export/png-encode.js';
export type { SvgDocumentOptions } from './export/svg-document.js';
export type { ColorOf, Rgba } from './export/colour-line.js';
export { colourAtStops, colourLineOf } from './export/colour-line.js';
export type { ColourLine, ResolvedStop } from './export/colour-line.js';
export { textPdf } from './export/text-pdf.js';
export type {
  BoxedPdfForm,
  PdfForm,
  PdfImage,
  PdfResources,
  TextPdf,
  TextPdfOptions,
  TextPdfResources,
} from './export/text-pdf.js';
export { FORM_EXTENT } from './export/text-pdf.js';
export type { JpegImage, PdfTilingPattern } from './export/pdf-resources.js';
export { pdfDocument } from './export/pdf-document.js';
export type { PdfPage } from './export/pdf-document.js';
export type { DecodedBitmap } from './export/png-decode.js';
export { decodePng } from './export/png-decode.js';
export { jpegInfo } from './export/jpeg-info.js';
export type { JpegInfo } from './export/jpeg-info.js';
export type { PdfEmbeddedFile, PdfFont, PdfSelectableOptions } from './export/pdf-text-layer.js';

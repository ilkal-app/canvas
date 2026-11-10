# @canvas/text

## Purpose

Font parsing, font metrics and text layout: how wide and tall a text is, line by line, in the
app's fonts. Pure TypeScript with no DOM and no GPU, so the renderer (`@canvas/engine`, which
re-exports what it used to define) and the agent surface (`@canvas/mcp`) measure text with the
same code. It also holds the bundled fonts' metrics as generated tables, so text can be
measured where the font files are not (the MCP service).

## Public API

- `parseFont`, `ParsedFont`, `FontFormatError`: Reads a TrueType file's character map, advances, kerning and glyph outlines.
- `collectionFaceCount`, `extractFace`, `postScriptNamesOf`: Font collections (TTC and OTC): a file's face count, one face as a standalone sfnt, and each face's PostScript name.
- `decodeWebFont`, `webFontFormatOf`, `MAX_DECODED_FONT_BYTES`: Web fonts (WOFF and WOFF2): the sfnt a file carries (WOFF2's glyf, loca and hmtx rebuilt; brotli's decoder imported only when a WOFF2 arrives), which web format a file is, and the size past which a decoded font is refused.
- `GlyphOutline`, `OutlineContour`, `OutlineSegment`, `LineSegment`, `QuadraticSegment`, `CubicSegment`: A glyph's outline in em: lines, quadratics (TrueType) and cubics (CFF and CFF2).
- `FontFaceKey`, `fontFaceId`, `fontFaceOf`, `resolveFontFace`, `fallbackFamily`: Faces, their ids, and the face a style is drawn with when its own is not loaded (its nearest weight); a run's face name picks that face of its family first, and a run without one draws the family's plain faces.
- `nearestWeights(weight, available)`: The available weights in the order CSS tries them for a desired one.
- `FontMetrics`, `createFontMetrics`, `subsetFontMetrics`, `FontMetricsLookup`: A face's advances, kerning and line metrics as plain data, and lookups over them.
- `GlyphMeasurer`, `LineMetrics`, `createMetricsMeasurer`: Measures glyphs for layout from metrics tables.
- `autoDirectionOf`: The direction a text's first paragraph takes when its own is auto (its first strong character's).
- `layoutText`, `lineExtent`, `LINE_HEIGHT_EM`, `TextLayout`, `TextAlign`, `TextBaseDirection`, `LayoutRun`, `LayoutGlyph`, `LayoutLine`, `LineExtent`, `CaretRect`: Line breaking, alignment and stacking of styled text; a `LayoutGlyph` is one glyph of a cluster, `index`..`end` its characters, with `glyphId` when shaped.
- `LayoutMarker`, `LayoutDecoration`, `listOrdinalsOf`, `listMarkerOf`, `LIST_INDENT_EM`, `MARKER_GAP_EM`, `DecorationMetrics`: lists and decorations: `layoutText` takes one `ParagraphStyle` per paragraph, indents a list paragraph `(level + 1) × 1.5 em` on its start side and gives it a marker (• ◦ ▪, or 1. a. i. numbering), and returns underline and strikethrough segments placed from the face's `post` and `OS/2` metrics.
- `loadShaper`, `Shaper`, `ShapingFace`, `shapeText`, `ShapedRun`, `ShapedGlyph`: HarfBuzz shaping (harfbuzzjs, loaded once per process by a dynamic import): a stretch of text as glyphs in visual order with their clusters, advances and offsets in em; `Shaper.outline` draws a glyph's outline, TrueType, CFF or CFF2, in em. `Shaper.face` takes a variable font's coordinates, normalised against its own axes, and shapes and draws at them. `shapeText` takes a run's OpenType feature settings over HarfBuzz's defaults; `layoutText` passes each run's `fontFeatures` and shapes runs with other settings apart.
- `ColourGlyphSource`, `ColourGlyphProgram`, `ColourGlyphOp` (and its variants `ColourGlyphPushTransform`, `ColourGlyphPopTransform`, `ColourGlyphPushClipGlyph`, `ColourGlyphPushClipRect`, `ColourGlyphPopClip`, `ColourGlyphSolid`, `ColourGlyphLinear`, `ColourGlyphRadial`, `ColourGlyphSweep`, `ColourGlyphImage`, `ColourGlyphPushGroup`, `ColourGlyphPopGroup`), `ColourGlyphOptions`, `ColourGlyphRgba`, `ColourGlyphStop`, `ColourGlyphExtend`, `ColourGlyphComposite`, `COLOUR_GLYPH_COMPOSITES`: Colour glyphs: `Shaper.hasColourGlyphs` and `Shaper.colourGlyph` record what HarfBuzz paints for a COLRv0/v1 glyph (transforms, glyph and rectangle clips, solid and linear, radial and sweep gradients with their extend modes, composite groups; a referenced colour glyph expanded in place) or a PNG bitmap strike (sbix, CBDT), as plain structured-cloneable ops in em, y up, for the engine to rasterise. SVG glyphs are not supported.
- `MAX_VARIATION_INSTANCES`: The most variable-font instances a shaper keeps fonts for; a dropped instance's font is made again on use.
- `readVariationAxes`, `VariationAxes`, `VariationAxis`, `NamedInstance`: A variable font's axes and named instances from its `fvar` and `name` tables, or undefined for a static or damaged one.
- `normaliseVariations`, `VARIATION_STEP`, `variationKey`: Requested coordinates clamped to a face's axes on a 1/16 grid with defaults dropped, and their canonical key (empty for the default instance).
- `MAX_SHAPER_FACE_BYTES`: The most font-file bytes a shaper keeps (128 MiB); past it the least recently used files are dropped and read again on their next use, and `Shaper.retainedFaceBytes` says how much is kept.
- `SHAPER_VERSION`: The harfbuzzjs package and version text is shaped with; `BUNDLED_FONTS_FINGERPRINT` hashes it.
- `createShapingMeasurer`, `ShapingFont`: A `GlyphMeasurer` whose layout shapes every segment with HarfBuzz, from font files and their metrics.
- `guessDirection`, `TextDirection`: The direction HarfBuzz guesses for a stretch of text, from its first character with a script of its own.
- `codepointAt`, `StringCharacter`, `NEWLINE`, `SPACE`: Walks a string by Unicode character.
- `readInkable`, `BASE_COLOR`: Reads a stored text or stroke colour tolerantly; the base colour for anything unreadable.
- `NOTE_PADDING`, `noteWrapWidth`, `noteMinHeight`, `noteHeightFor`, `noteBoxHeight`, `CONNECTOR_LABEL_WRAP_WIDTH`: The sizing rules of sticky notes (square or wide) and connector labels.
- `fitNoteText`, `fittedNoteHeight`, `NOTE_FIT_FLOOR_PX`, `NoteFit`, `NoteFitInput`, `NoteFitLayout`: Sticky auto-fit: a note's text at the largest whole size of its largest run, from the stored maximum down to an 8 px floor, that fits its text box, every run scaled by one factor, laid out with the caller's measurer; and the height a note is measured to, growing only when its text overflows at the floor.
- `clampLines`, `LINE_CLAMP_ELLIPSIS`, `LineClamp`, `LineClampLayout`: Line caps: each paragraph of a text cut to its most lines, its last allowed line ending with '…' as late as it fits, found by bisection with the caller's layout; a text box asks for it with `lineCaps`.
- `shapeLabelBox`, `shapeLabelWrapWidth`, `labelPaddingOf`, `LABEL_PADDING`, `LABEL_PADDING_FRACTION`, `ShapeLabelRect`, `ShapeLabelGeometry`: The box a shape's label sits in and wraps at.
- `textPlacementOf`, `textOriginOf`, `noteTextPlacement`, `shapeLabelPlacement`, `connectorLabelPlacementAt`, `TextBoxGeometry`, `TextVerticalAlign`, `ConnectorLabelPointOf`: Where an object's text box sits in its frame and how it wraps and aligns (text objects, sticky notes, shape labels, and connector labels at a point the caller finds on the route), and where its laid-out text starts; the engine's text pass, the page's editor and the vector export all place text by it.
- `polygonFitOf`, `unitPolygonVertex`, `unitPolygonInradius`, `starInnerRadius`, `STAR_INNER_SCALE`, `PolygonFit`, `ShapeVector`: Regular polygons and stars inscribed in a shape's box.
- `DEFAULT_FONT_FAMILY`, `BUNDLED_FONT_FAMILIES`, `bundledFamilyMetrics`: The families the app bundles and their faces' metrics, decoded from the generated tables.
- `BUNDLED_FONT_CATALOGUE`, `BundledFontFamily`, `BundledFontFace`, `FONT_CATEGORIES`, `FontCategory`: The bundled families with their picker category and the faces each supplies, the default first (what MCP `list_fonts` reports).
- `shapeWithMetrics(metrics, text, start, end, direction?)`, `TableFontMetrics`: Shapes a stretch from a face's metrics alone, one glyph per cluster with pair kerning, as HarfBuzz shapes a face whose only positioning is pair kerning, with the table's ligatures as one glyph each and its lone-mark advances, for a face measured from a table without its file.
- `measuringFontsFor`, `MeasuringFonts`, `UnknownFamily`, `WeightFallback`: The bundled metrics some texts need, the default family first; a family the app does not bundle is reported with the fallback it is measured in, and a weight a bundled family lacks with the weight of the nearest face drawn in its place.
- `CoverageMeasuring`: The texts and a coverage source `measuringFontsFor` takes to add the script faces they need, parsed from their files; a family the source lacks is listed in `unmeasuredFamilies`.
- `missingClusterGlyphs(text, runs, faceOf, candidates)`: `missingGlyphs` over any fallback faces, such as a host's loaded faces.
- `coverageMeasureRuns(text, runs, fonts)`, `missingGlyphs(text, runs, fonts)`, `MissingGlyph`: The runs a text is measured with, each grapheme cluster its font cannot draw whole moved into the coverage face that can (as the engine's `coverageRuns` draws it), and the characters no available face can draw, with their code point and UTF-16 index.
- `fallbackRuns(text, runs, faceOf, candidates)`, `FallbackFace`: Font fallback per grapheme cluster, shared by layout, measurement and the render service: a cluster drawn as emoji goes to the emoji face when it draws all of it, else the run's own face, else a face of the cluster's script, else any face that draws the whole cluster.
- `isEmojiPresentation(cluster)`: Whether a grapheme cluster is drawn as emoji (UTS #51, UCD 17): an RGI sequence (ZWJ, skin tone, flag, tag), VS16 or an emoji-default character; never with VS15, and not a text-default character alone.
- `scriptOf(codepoint)`, `scriptExtensionsOf(codepoint)`, `SCRIPT_CODES`, `ScriptCode`, `clusterScript(text, start, end, previous?)`: The Script and Script_Extensions properties of Unicode 17.0.0 by ISO 15924 code, generated from the UCD, and a grapheme cluster's script.
- `fallbackFamiliesOf(script, lang?)`, `EMOJI_FAMILY`, `HAN_LANGUAGE_FAMILIES`: The Noto families to try for text in a script, Han's by language, every Han face, and the emoji face's one name, Noto Color Emoji (COLRv1).
- `isCoverageFamily(family)`: Whether a family is a script or symbol coverage face that fallback draws in.
- `measureOverrideText(board, instance, path, record)`, `OverrideMeasurement`: The text size an instance's override record gives a text or sticky child, measured at the child's own box with the bundled fonts and stamped with `BUNDLED_FONTS_FINGERPRINT`; MCP and the app's override size follower both store it as `measuredSize`.
- `BUNDLED_FONTS_FINGERPRINT`: 16 hex digits naming the bundled and coverage faces' metrics; it changes whenever a font import changes them, so a text size stored with it can be told stale (for).
- `symbolCoverageMetrics()`: The symbol faces' metrics (Noto Sans Math, Noto Sans Symbols 2), in fallback order; `measuringFontsFor` adds them after the bundled families.
- `coverageNeeds(text, runs?)`, `CoverageNeed`: The coverage faces a text needs, and for each CJK face the slices its characters are in and the weights its runs draw them in, character by character (a run naming a CJK face keeps its characters); shared by the app's loading and the render page's.
- `CoverageNeedsCache`: `coverageNeeds` for texts that change a little at a time, such as a draft being typed: the text is cut into chunks by its content and each chunk's needs are kept, so an edit reads only the chunks it touched.
- `SYMBOL_COVERAGE_FAMILIES`, `symbolCoverageFamilies(text)`: The symbol faces, and which of them a text needs for the symbols it holds, loaded on demand like the Noto script faces.
- `scriptCoverageFamilies(text)`, `hasScriptCoverage(codePoint)`, `SCRIPT_COVERAGE_FAMILIES`: The Noto script faces a text needs, one per script it holds that the app has a face for, whether a character is in such a script, and every such face in list order (from the script table since).
- `measureText`, `TextMeasurement`, `TextBoxDirection`: A text's laid-out width, height and line count; given the measurer of `prepareMeasuringFonts`, shaped; in a box's alignment and base direction.
- `prepareMeasuringFonts(runSets, source)`, `PreparedMeasuringFonts`, `FontBytesSource`: `measuringFontsFor` plus a measurer that shapes with HarfBuzz from the faces' files, read through an injected source once per source.
- `MissingFontFileError`, `TextShapingOptions`: The face whose file a shaped measurement needs and its source lacks; `readFiles: 'when-shaped'` reads a face's file only when text is shaped with it.
- `createTextShaping(shaper, source, options?)`, `TextShaping`, `SyncFontBytesSource`: Synchronous HarfBuzz measuring once the shaper has loaded: `measurerFor(fonts)` shapes with the faces' files, read once each; `measureObjectText` and `measureOverrideText` take it. A source's optional `metricsOf(face)` gives a face it has no file for, measured and shaped from its table. Its `shaper` and `fontFileOf(faceId)` (the files its measurers read) let the vector export outline and embed the faces a layout used; a server's optional `subsetter` cuts an embedded CJK slice down to the export's characters.
- `lineBreakOpportunities(text, options?)`, `LineBreakOpportunity`, `LineBreakOptions`: Every place a line may or must end, by the Unicode line breaking algorithm (UAX #14, Unicode 17.0.0), Thai, Lao, Khmer and Myanmar broken at dictionary word boundaries unless `complexContext` is `none`.
- `lineBreakClassOf(codepoint)`, `eastAsianWidthOf(codepoint)`, `LineBreakClass`, `LINE_BREAK_CLASSES`: A codepoint's Line_Break class and East_Asian_Width, from a table generated from UCD 17.0.0 and checked against it.
- `LINE_BREAKING_VERSION`: The line breaking rules layout follows; `BUNDLED_FONTS_FINGERPRINT` hashes it, so sizes measured under other rules are stale.
- `resolveParagraphLevels(text, direction?)`, `ParagraphDirection`, `BidiParagraphLevels`: A paragraph's embedding levels by the Unicode bidirectional algorithm (UAX #9, Unicode 17.0.0), per UTF-16 code unit, its direction stated or found from its first strong character.
- `lineLevels(levels, classes, paragraphLevel)`, `visualOrder(levels)`: Rules L1 (trailing whitespace and separators to the paragraph level) and L2 (the visual order) for one line.
- `splitParagraphs(text)`, `ParagraphRange`: Rule P1: a text's paragraphs, each ending after its paragraph separator.
- `bidiClassOf(codepoint)`, `pairedBracketOf(codepoint)`, `mirroredCodepointOf(codepoint)`, `BidiClass`, `BIDI_CLASSES`, `PairedBracket`: A codepoint's Bidi_Class, paired bracket and mirrored glyph, from tables generated from UCD 17.0.0 and checked against it.
- `expandedGlyphsOf(codepoint)`: The most glyphs a bundled face shapes a codepoint to, alone or in a joining form, from a generated table checked against the files; the engine sizes text records with it.
- `bundledFontFile(face)`, `bundledFontFilePaths()`, `BundledFontFile`: The file a bundled or symbol coverage face's metrics were generated from, by path from the repository root.
- `effectiveLanguage(lang, kana, index)`, `KanaParagraphs`: The language Han takes at an index, a run's tag or Japanese where the paragraph holds kana, for a host that picks Han's face per character (the app's CJK slice loading).
- `cjkSliceOf(family, codepoint)`, `cjkSlices(family, codepoints)`: Which slice of a CJK face (Noto Sans SC, TC, HK, JP, KR) a character is in, with no font needed: `base`; `han-0`, the legacy standard's common level whole (GB 2312 level 1, Big5's frequent ideographs, JIS X 0208 level 1), since each orders it by reading or strokes; the standard's other ideographs 500 a slice (Korean's Hanja from `han-0`); then the rest by codepoint window from U+3400; Korean syllables likewise.
- `cjkSliceFace(face, id)`, `cjkSliceIdOf(face)`: A slice as a face of its own, a named face `cjk-slice:<id>` ('s mechanism), so a family's slices coexist and fallback names the one it picks.
- `createSubsetter(wasm)`, `Subsetter`, `buildCjkSlices(subsetter, family, font)`: HarfBuzz's hb-subset over its WebAssembly build (`isRetainingGlyphIds` keeps every glyph's id), and a CJK face cut into its slice files.
- `coverageFontFile(face)`, `COVERAGE_FONT_FILES`: The file of each Noto coverage face, by path from the repository root.
- `serverCoverageFamilies()`, `serverCoverageFontFilePaths()`: The script faces a server deploys and measures with, all but the Han faces, and their files.
- `glyphPathData`, `glyphPdfPath`, `glyphTransform`, `composeAffine`, `IDENTITY_AFFINE`, `Affine`, `formatNumber`: A glyph outline as SVG path data or PDF path operators under an affine transform, where a laid-out glyph's em outline goes in its text box, and the short decimal form every exported number is written in.
- `textVectors`, `VectorGlyph`, `OutlineVectorGlyph`, `LayersVectorGlyph`, `ImageVectorGlyph`, `VectorCluster`, `VectorGlyphSource`: A laid-out text as vectors, each glyph's placed outline, a colour glyph's painted layers or bitmap.
- `colourLayers`, `ColourLayers`, `VectorLayer`, `VectorRegion`, `VectorGroup`, `VectorGradient`, `VectorLinearGradient`, `VectorRadialGradient`, `VectorSweepGradient`, `VectorGradientStop`, `VectorImage`, `VectorFill`: A colour glyph's paint program replayed into vector layers (a clip's region cut by its outer clips, with a flat colour or a gradient, in groups with their composite modes) or its placed bitmap.
- `textSvg`, `TextSvg`, `TextSvgOptions`, `SelectableTextOptions`, `EmbeddedFontFile`, `ColorOf`, `Rgba`: A laid-out text's vectors as an SVG fragment (outlines, colour layers with clips, gradients and blend groups, bitmaps as PNG images), with an optional invisible text layer for selection that embeds a font only when the caller allows.
- `svgDocument`, `SvgDocumentOptions`: A standalone SVG document around exported fragments.
- `decodePng`, `jpegInfo`, `JpegInfo`, `JpegImage`: A PNG's pixels (8-bit RGB or RGBA, not interlaced) for a PDF image with a soft mask, or the reason it cannot be read; a JPEG's size and components from its frame, so a PDF embeds it as it is (`JpegImage`, `/DCTDecode`).
- `base64Of`: Bytes as padded base64, without DOM or Node globals: exported images and files.
- `colourLineOf`, `colourAtStops`, `ColourLine`, `ResolvedStop`: A colour glyph gradient's colour line resolved as COLRv1 defines it for writers that spread a line over 0..1: stops resolved to RGBA, the line from its first stop to its last, a radial cone cut at its zero-radius tip; null when it paints nothing.
- `PdfTilingPattern`: A coloured tiling pattern among `pdfDocument`'s resources: a cell's content, its steps, and its matrix to the page's default space (a vector export's tiled image fills).
- `PdfForm`, `BoxedPdfForm`, `TextPdfResources`, `FORM_EXTENT`: A transparency group's form for `pdfDocument`: its content, drawn in a box reaching 1e6 round the origin, or its content and its own `bbox` (a vector export's object groups take the page's box, since some readers draw a far larger box blank); a text's own resources, whose forms are content alone.
- `textPdf`, `TextPdf`, `TextPdfOptions`, `PdfResources`, `PdfImage`, `DecodedBitmap`: A laid-out text's vectors as PDF content and its named resources: outlines, colour layers with clips, gradients as shadings (repeat and reflect stitched), sweeps as wedges, groups with blend modes, bitmaps as image XObjects with soft masks.
- `PdfFont`, `PdfSelectableOptions`, `PdfEmbeddedFile`: The PDF writer's selectable text layer (`TextPdfOptions.selectable`): invisible text over the vectors, each cluster's exact text as /ActualText, glyphs by id in an embedded face (Type0, Identity-H, ToUnicode) when the caller allows, or Helvetica.
- `pdfDocument`, `PdfPage`: A PDF 1.7 file around exported pages: catalog, page tree, resources, exact xref.
- `fsTypeOf`, `FontEmbedding`: A font's embedding rights from its OS/2 fsType.
- `measureObjectText`, `MeasurableObject`, `MeasurableTextObject`, `MeasurableNote`, `MeasurableShape`, `MeasurableConnector`, `ObjectTextMeasurement`, `TextBoxSize`, `MIN_TEXT_BOX_SIZE`: An object's measured text and the box the app sizes a text object or sticky note to.

## Depends on

`@canvas/schema` (text styles and runs). Nothing else; no DOM, GPU or Node API in `src/` (tests
read font files from disk).

## How to test

`pnpm vitest --project @canvas/text`. The tests that need real fonts read the bundled files:
Liberation Sans from `packages/engine/assets/fonts`, the curated library from
`packages/app/assets/fonts/library`. `packages/app/src/text-input/agent-text-measurement.test.ts`
holds the bundled tables' measurements to the app's own layout path (within 0.5 px).

## Design notes

- **Generated metrics.** `src/bundled/generated/` holds one module per bundled family: each
  face's metrics as a short string of integer font units (`src/bundled/face-encoding.ts`), about
  430 KB for all 104 faces. Decoding gives back exactly what `createFontMetrics` builds from the
  file. `src/bundled/bundled-font-metrics.test.ts` fails when a font or the catalogue changes
  without the tables; regenerate with
  `UPDATE_BUNDLED_METRICS=1 pnpm vitest run --project @canvas/text bundled-font-metrics`, then
  `pnpm exec prettier --write packages/text/src/bundled/generated`.
- **Kerning** is read from the legacy `kern` table only, as the app lays out; fonts that kern
  only through GPOS lay out unkerned in both.
- **Shaping**: `createShapingMeasurer` lays text out from HarfBuzz
  instead (ligatures, GPOS kerning, complex scripts), matching `hb-shape` on the samples in
  `src/shaping/__fixtures__/`. A segment (runs of one face and size between hard breaks) is
  shaped once; lines wrap between its clusters with the rule above, and a piece of a segment cut
  where HarfBuzz flags a glyph unsafe to break is shaped again on its own. A right-to-left segment
  is placed in visual order; mixing directions on a line waits for bidi. The engine and
  MCP switch to it together, keeping their measurements identical.
- **Shape labels** wrap at the width of the box inscribed in the shape's kind, so the polygon
  geometry that box depends on lives here too (the renderer re-exports it).
- **Not covered**: the on-demand Noto coverage fonts the app loads for scripts the bundled fonts
  lack (their characters measure at the face's missing-glyph advance), fonts installed on a
  person's computer, and remote catalogue families (reported as unknown).

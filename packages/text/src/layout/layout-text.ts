import {
  paragraphCount,
  type LetterSpacing,
  type LineHeight,
  type ParagraphStyle,
  type StyleRun,
} from '@canvas/schema';

import { variationKey } from '../variation/variation-key.js';

import type { GlyphMeasurer } from './glyph-measurer.js';
import { readInkable } from './inkable-color.js';
import { alignLines } from './line-alignment.js';
import { breakLines, type BreakingRun } from './line-breaking.js';
import { stackLines } from './line-metrics.js';
import { listLayoutOf, listParagraphAt, markersOf, noIndent } from './list-layout.js';
import { RunCursor } from './run-cursor.js';
import { breakShapedLines } from './shaped-line-breaking.js';
import { textBidi } from './text-bidi.js';
import { decorationsOf } from './text-decorations.js';
import type {
  LayoutGlyph,
  LayoutLine,
  LayoutRun,
  TextAlign,
  TextBaseDirection,
  TextLayout,
} from './text-layout.js';

/** The weight axis's tag, which a run's weight drives unless its coordinates set it. */
const WEIGHT_AXIS = 'wght';

/**
 * Whether a measurer shapes.
 *
 * @param measurer - The measurer.
 * @returns True when it has `shape`.
 */
function isShaping(
  measurer: GlyphMeasurer,
): measurer is GlyphMeasurer & Required<Pick<GlyphMeasurer, 'shape'>> {
  return measurer.shape !== undefined;
}

/**
 * The variable-font coordinates a run is shaped and drawn at: its requested ones as the
 * measurer normalises them for its face, its weight standing for the `wght` axis when it sets
 * none (as CSS's font-weight drives a variable font's weight axis unless font-variation-settings
 * sets it). None when the measurer does not shape at coordinates or they are the face's
 * defaults. An empty run shapes nothing, so it asks for none: a measurer that reads files when it
 * shapes reads none for empty text.
 *
 * @param measurer - The measurer.
 * @param faceId - The run's face.
 * @param run - The run.
 * @returns The coordinates, or undefined for the face's defaults.
 */
function runVariations(
  measurer: GlyphMeasurer,
  faceId: string,
  run: StyleRun,
): Readonly<Record<string, number>> | undefined {
  if (run.length === 0 || measurer.variationsOf === undefined) return undefined;
  const { fontVariations, weight } = run.style;
  const requested =
    fontVariations?.[WEIGHT_AXIS] === undefined
      ? { ...fontVariations, [WEIGHT_AXIS]: weight }
      : fontVariations;
  const variations = measurer.variationsOf(faceId, requested);
  return Object.keys(variations).length === 0 ? undefined : variations;
}

/**
 * A run's OpenType feature settings, or `undefined` for none: an empty record is none.
 *
 * @param features - The run style's settings.
 * @returns The settings, or `undefined`.
 */
function featuresOf(
  features: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> | undefined {
  return features === undefined || Object.keys(features).length === 0 ? undefined : features;
}

/**
 * Feature settings as a key, sorted by tag, so equal settings in any order group together.
 *
 * @param features - The settings.
 * @returns The key.
 */
function featureKey(features: Readonly<Record<string, number>>): string {
  return Object.keys(features)
    .sort()
    .map((tag) => `${tag}=${String(features[tag])}`)
    .join(',');
}

/**
 * A letter-spacing in world units.
 *
 * @param spacing - The run's letter-spacing, or undefined for none.
 * @param fontSize - The run's font size, which a percent is of.
 * @returns The spacing, 0 for none.
 */
function spacingPx(spacing: LetterSpacing | undefined, fontSize: number): number {
  if (spacing === undefined) return 0;
  return spacing.unit === 'px' ? spacing.value : (spacing.value / 100) * fontSize;
}

/**
 * A line-height in world units.
 *
 * @param height - The run's line-height, or undefined for auto.
 * @param fontSize - The run's font size, which a percent is of.
 * @returns The height, or undefined for auto.
 */
function lineHeightPx(height: LineHeight | undefined, fontSize: number): number | undefined {
  if (height === undefined || height === 'auto') return undefined;
  return height.unit === 'px' ? height.value : (height.value / 100) * fontSize;
}

/**
 * A style run as the breaker takes it: its layout run, and the group of runs shaped together.
 *
 * @param measurer - Faces and their variable-font coordinates.
 * @param styleRun - The style run.
 * @returns The breaking run.
 */
function breakingRunOf(measurer: GlyphMeasurer, styleRun: StyleRun): BreakingRun {
  const { style } = styleRun;
  const isLink = style.link !== undefined;
  // A link draws in its run's own colour, ink included, and is told apart by its underline
  // ().
  const color = readInkable(style.color);
  const { fontSize } = style;
  const letterSpacing = spacingPx(style.letterSpacing, fontSize);
  const lineHeight = lineHeightPx(style.lineHeight, fontSize);
  const faceId = measurer.faceIdOf(style);
  const variations = runVariations(measurer, faceId, styleRun);
  const fontFeatures = featuresOf(style.fontFeatures);
  const run: LayoutRun = {
    faceId,
    fontSize,
    color,
    ...(letterSpacing === 0 ? {} : { letterSpacing }),
    ...(lineHeight === undefined ? {} : { lineHeight }),
    ...(variations === undefined ? {} : { variations }),
    ...(style.lang === undefined ? {} : { lang: style.lang }),
    ...(fontFeatures === undefined ? {} : { fontFeatures }),
    ...(isLink ? { isLink: true as const } : {}),
    ...(style.underline === true ? { underline: true as const } : {}),
    ...(style.strikethrough === true ? { strikethrough: true as const } : {}),
  };
  // Runs at other coordinates are other instances: never shaped together; a language
  // change cuts a shaping segment too: HarfBuzz shapes by language; and so does a
  // change of feature settings.
  const instance = variations === undefined ? '' : `|${variationKey(variations)}`;
  const features = fontFeatures === undefined ? '' : featureKey(fontFeatures);
  return {
    run,
    kerningGroup: `${String(run.fontSize)}|${run.faceId}${instance}|${run.lang ?? ''}|${features}`,
  };
}

/**
 * The aligned lines' glyphs in the box's frame: offset by their line's x, on its baseline.
 *
 * @param aligned - The lines with their offsets, and their glyphs relative to their start.
 * @returns The lines and the placed glyphs, in order.
 */
function placedOf(aligned: ReturnType<typeof alignLines>): {
  readonly lines: LayoutLine[];
  readonly glyphs: LayoutGlyph[];
} {
  const lines: LayoutLine[] = [];
  const glyphs: LayoutGlyph[] = [];
  for (const { line, lineGlyphs } of aligned) {
    lines.push(line);
    for (const glyph of lineGlyphs) {
      const { codepoint, index, end, glyphId, level, advance, run } = glyph;
      const x = glyph.x + line.x;
      const y = line.baseline - glyph.yOffset;
      glyphs.push({ codepoint, index, end, glyphId, level, line: glyph.line, x, y, advance, run });
    }
  }
  return { lines, glyphs };
}

/**
 * Lays out rich text: run-aware line breaking with kerning and letter-spacing, per-line metrics
 * (each line as tall as its tallest run's line-height, sharing one baseline) and alignment. Ported from the prototype's
 * `layoutText` (`src/text/layout.ts`), the module that made every text behaviour unit-testable;
 * it is pure and DOM-free, so it runs in a `layout` job on a worker or
 * on the main thread. The text and runs are plain values (the Y.Text mapping is
 *'s); the runs must satisfy the schema's run invariant (`findRunIssues`). Inputs are
 * never mutated.
 *
 * @param text - The characters, a JavaScript (UTF-16) string.
 * @param runs - Style runs covering the text in order.
 * @param maxWidth - The wrapping width, in world units; `null` for auto-width text, which wraps
 *   only at newlines.
 * @param measurer - Faces, advances, kerning and line metrics.
 * @param align - Horizontal alignment of each line. Default `left`. `start` and `end` take each
 *   line's side from its paragraph's direction.
 * @param direction - The base direction of each paragraph. Default `auto`: its first
 *   strong character's. A measurer that does not shape orders no text, but the direction still
 *   sets the side of `start` and `end`.
 * @param paragraphs - One style per paragraph, absent for all plain: a list paragraph
 *   is indented by `(level + 1) × LIST_INDENT_EM` of its first run's size on its start side,
 *   every line of it wrapping in the room left (a hanging indent), and gets a marker.
 * @returns The laid-out text, in the box's frame, with its list markers and its underline and
 *   strikethrough segments.
 * @throws {RangeError} When `runs` is empty, or `paragraphs` does not have one style per
 *   paragraph.
 */
export function layoutText(
  text: string,
  runs: readonly StyleRun[],
  maxWidth: number | null,
  measurer: GlyphMeasurer,
  align: TextAlign = 'left',
  direction: TextBaseDirection = 'auto',
  paragraphs?: readonly ParagraphStyle[],
): TextLayout {
  if (paragraphs !== undefined && paragraphs.length !== paragraphCount(text)) {
    throw new RangeError('Layout needs one paragraph style per paragraph.');
  }
  const lists = listLayoutOf(text, runs, paragraphs);
  const indentAt =
    lists === undefined
      ? noIndent
      : (index: number) => lists.indents[listParagraphAt(lists, index)] ?? 0;
  const spans = runs.map(({ length, style }) => ({
    length,
    value: breakingRunOf(measurer, { length, style }),
  }));
  const cursor = new RunCursor(spans);
  const broken: ReturnType<typeof breakShapedLines> = isShaping(measurer)
    ? breakShapedLines(
        text,
        cursor,
        maxWidth,
        (faceId, source, start, end, shapeDirection, variations, language, features) =>
          measurer.shape(
            faceId,
            source,
            start,
            end,
            shapeDirection,
            variations,
            language,
            features,
          ),
        direction,
        indentAt,
      )
    : breakLines(text, cursor, maxWidth, measurer, indentAt);
  const stacked = stackLines(broken.lines, broken.glyphs, cursor, measurer);
  const width = broken.lines.reduce(
    (widest, line) => Math.max(widest, line.width + indentAt(line.start)),
    0,
  );
  const baseLevel = direction === 'rtl' ? 1 : 0;
  // The metrics path orders nothing, but an auto text's start and end still follow each
  // paragraph's first strong character.
  const isLogical = align === 'start' || align === 'end';
  const paragraphLevels =
    broken.paragraphLevels ??
    ((isLogical || lists !== undefined) && direction === 'auto'
      ? textBidi(text)?.paragraphLevels
      : undefined);
  const levelAt = (start: number) =>
    paragraphLevels === undefined ? baseLevel : (paragraphLevels[start] ?? baseLevel);
  const aligned = alignLines(stacked.lines, align, maxWidth, width, levelAt, indentAt);
  const { lines, glyphs } = placedOf(aligned);
  const layoutRuns = spans.map(({ value }) => value.run);
  const markers = lists === undefined ? [] : markersOf(lists, lines, layoutRuns, measurer, levelAt);
  const decorations = decorationsOf(lines, glyphs, layoutRuns, measurer);
  return {
    text,
    runs: layoutRuns,
    glyphs,
    lines,
    width,
    height: stacked.height,
    markers,
    decorations,
  };
}

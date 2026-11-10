import type { ParagraphStyle, StyleRun } from '@canvas/schema';

import { codepointAt } from './codepoints.js';
import type { GlyphMeasurer } from './glyph-measurer.js';
import { LIST_INDENT_EM, listMarkerOf, listOrdinalsOf, MARKER_GAP_EM } from './list-markers.js';
import type { LayoutGlyph, LayoutLine, LayoutMarker, LayoutRun } from './text-layout.js';

/**
 * No indent: every line of a text without lists.
 *
 * @returns 0.
 */
export function noIndent(): number {
  return 0;
}

/** A text's list paragraphs as layout needs them. */
export interface ListLayout {
  /** Where each paragraph starts, in UTF-16 code units, ascending. */
  readonly starts: readonly number[];
  /** Each paragraph's style. */
  readonly paragraphs: readonly ParagraphStyle[];
  /** Each paragraph's ordinal, for a numbered one. */
  readonly ordinals: readonly (number | undefined)[];
  /** The run each paragraph starts in, an index into the runs. */
  readonly runAt: readonly number[];
  /** Each paragraph's indent, in world units; 0 for a plain one. */
  readonly indents: readonly number[];
}

/**
 * The run an index falls in: the one covering it, or the last run at the text's end.
 *
 * @param runs - The runs.
 * @param index - A UTF-16 index.
 * @returns The run's index.
 */
function runIndexAt(runs: readonly StyleRun[], index: number): number {
  let offset = 0;
  for (const [at, run] of runs.entries()) {
    offset += run.length;
    if (offset > index) return at;
  }
  return Math.max(0, runs.length - 1);
}

/**
 * A text's list paragraphs: where each starts, its run, its ordinal and its indent,
 * `(level + 1) × LIST_INDENT_EM` of its first run's font size. Pure.
 *
 * @param text - The text.
 * @param runs - Its runs.
 * @param paragraphs - One style per paragraph, or none.
 * @returns The lists, or `undefined` when no paragraph is a list.
 */
export function listLayoutOf(
  text: string,
  runs: readonly StyleRun[],
  paragraphs: readonly ParagraphStyle[] | undefined,
): ListLayout | undefined {
  if (paragraphs?.some((style) => style.list !== undefined) !== true) return undefined;
  const starts = [0];
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  const runAt = starts.map((start) => runIndexAt(runs, start));
  const indents = paragraphs.map((style, paragraph) => {
    if (style.list === undefined) return 0;
    const fontSize = runs[runAt[paragraph] ?? 0]?.style.fontSize ?? 0;
    return ((style.level ?? 0) + 1) * LIST_INDENT_EM * fontSize;
  });
  return { starts, paragraphs, ordinals: listOrdinalsOf(paragraphs), runAt, indents };
}

/**
 * The paragraph an index falls in.
 *
 * @param lists - The text's lists.
 * @param index - A UTF-16 index.
 * @returns The paragraph's index.
 */
export function listParagraphAt(lists: ListLayout, index: number): number {
  let low = 0;
  let high = lists.starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((lists.starts[middle] ?? 0) <= index) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** A marker's glyphs at the origin, and its width. */
interface MarkerShape {
  readonly glyphs: readonly Omit<LayoutGlyph, 'x' | 'y' | 'line'>[];
  /** Each glyph's pen x and its offsets, relative to the marker's left edge, world units. */
  readonly pens: readonly { readonly x: number; readonly yOffset: number }[];
  readonly width: number;
}

/**
 * Shapes a marker in its run's face: with the measurer's shaper when it has one, so
 * the glyphs are keyed by glyph id as the text's own are; else per codepoint. Markers read left
 * to right in either direction (`1.`, `•`).
 *
 * @param text - The marker.
 * @param run - Its run.
 * @param runIndex - The run's index.
 * @param at - The paragraph's start, which the glyphs give as their index.
 * @param measurer - Advances, or the shaper.
 * @returns Its glyphs and width.
 */
function shapeMarker(
  text: string,
  run: LayoutRun,
  runIndex: number,
  at: number,
  measurer: GlyphMeasurer,
): MarkerShape {
  const size = run.fontSize;
  const glyphs: Omit<LayoutGlyph, 'x' | 'y' | 'line'>[] = [];
  const pens: { x: number; yOffset: number }[] = [];
  let pen = 0;
  if (measurer.shape !== undefined) {
    const shaped = measurer.shape(run.faceId, text, 0, text.length, 'ltr', run.variations);
    for (const glyph of shaped.glyphs) {
      const { codepoint } = codepointAt(text, glyph.cluster);
      const advance = glyph.advance * size;
      glyphs.push({
        codepoint,
        index: at,
        end: at,
        glyphId: glyph.glyphId,
        level: 0,
        advance,
        run: runIndex,
      });
      pens.push({ x: pen + glyph.xOffset * size, yOffset: glyph.yOffset * size });
      pen += advance;
    }
    return { glyphs, pens, width: pen };
  }
  for (let offset = 0; offset < text.length;) {
    const { codepoint, length } = codepointAt(text, offset);
    const advance = measurer.advance(run.faceId, codepoint) * size;
    glyphs.push({ codepoint, index: at, end: at, glyphId: null, level: 0, advance, run: runIndex });
    pens.push({ x: pen, yOffset: 0 });
    pen += advance;
    offset += length;
  }
  return { glyphs, pens, width: pen };
}

/**
 * The markers of a text's list paragraphs, each on its paragraph's first line: before
 * the line's start in a left-to-right paragraph, after its end in a right-to-left one, a gap of
 * `MARKER_GAP_EM` away. Pure.
 *
 * @param lists - The text's lists.
 * @param lines - The aligned lines.
 * @param runs - The layout runs.
 * @param measurer - Advances.
 * @param levelAt - The paragraph level at an index.
 * @returns One marker per list paragraph, in paragraph order.
 */
export function markersOf(
  lists: ListLayout,
  lines: readonly LayoutLine[],
  runs: readonly LayoutRun[],
  measurer: GlyphMeasurer,
  levelAt: (index: number) => number,
): LayoutMarker[] {
  const markers: LayoutMarker[] = [];
  lists.paragraphs.forEach((style, paragraph) => {
    const text = listMarkerOf(style, lists.ordinals[paragraph]);
    const start = lists.starts[paragraph] ?? 0;
    const lineIndex = lines.findIndex((line) => line.start >= start);
    const line = lines[lineIndex];
    const runIndex = lists.runAt[paragraph] ?? 0;
    const run = runs[runIndex];
    if (text === undefined || line === undefined || run === undefined) return;
    const shape = shapeMarker(text, run, runIndex, start, measurer);
    const { width } = shape;
    const gap = MARKER_GAP_EM * run.fontSize;
    const isRightToLeft = levelAt(start) % 2 === 1;
    const x = isRightToLeft ? line.x + line.width + gap : line.x - gap - width;
    const glyphs = shape.glyphs.map((glyph, index): LayoutGlyph => {
      const pen = shape.pens[index] ?? { x: 0, yOffset: 0 };
      return { ...glyph, line: lineIndex, x: x + pen.x, y: line.baseline - pen.yOffset };
    });
    markers.push({
      paragraph,
      line: lineIndex,
      text,
      x,
      baseline: line.baseline,
      width,
      run: runIndex,
      glyphs,
    });
  });
  return markers;
}

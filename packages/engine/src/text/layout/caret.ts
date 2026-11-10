import type { CaretRect, LineExtent, TextLayout } from '@canvas/text';

import {
  isMixedLine,
  mixedIndexAtLine,
  mixedPlacement,
  mixedSpans,
  mixedVisualStep,
} from './caret-bidi.js';
import {
  clustersOnLine,
  insideCluster,
  lineAt,
  lineEndIndex,
  lineOf,
  outsideLineBreak,
} from './caret-clusters.js';

// Caret and hit-testing helpers over a TextLayout, ported from the prototype's
// `src/text/layout.ts`. Indices are UTF-16 caret positions (0 to text.length); coordinates are
// world units in the box's frame. A line with right-to-left text places, hits and selects by its
// glyphs' visual boxes (`caret-bidi.ts`); a left-to-right line exactly as before.

export { lineEndIndex, lineOf } from './caret-clusters.js';

/** Where a caret index draws on its line. */
export interface CaretPlacement {
  /** The caret's x: before the grapheme after it, in that grapheme's direction. */
  readonly primary: number;
  /**
   * Where text changes direction at the index, the x after the grapheme before it, in its
   * direction: the caret splits, drawn here too. Absent on a left-to-right line and inside a run.
   */
  readonly secondary?: number;
}

/**
 * Where a caret index draws: on a left-to-right line at the x of the glyph at the index, inside a
 * shaped cluster its grapheme's share, at a line's end after it; on a line with
 * right-to-left text at the leading edge of the grapheme after the index, or the trailing edge of
 * the one before it at the line's end, split where the direction changes.
 *
 * @param layout - The laid-out text.
 * @param caretIndex - A caret index; one inside CR LF stands for the one before the CR.
 * @returns The caret's x, and the split caret's other x where there is one.
 */
export function caretPlacement(layout: TextLayout, caretIndex: number): CaretPlacement {
  // An index inside CR LF draws where the one before the CR does.
  const index = outsideLineBreak(layout.text, caretIndex);
  const lineIndex = lineOf(layout, index);
  const line = lineAt(layout, lineIndex);
  if (isMixedLine(layout, lineIndex)) return mixedPlacement(layout, lineIndex, index);
  const glyph =
    index < line.end ? layout.glyphs.find((candidate) => candidate.index === index) : undefined;
  return { primary: glyph?.x ?? insideCluster(layout, lineIndex, index) ?? line.x + line.width };
}

/** One line's part of a selection: from `left` to `right`, in world units. */
export interface SelectionSpan {
  /** The line. */
  readonly line: number;
  /** Its left, in world units. */
  readonly left: number;
  /** Its right. */
  readonly right: number;
}

/**
 * The spans a range draws as, top to bottom: on a left-to-right line from the start's caret (or
 * the line's start) to the end's (or the line's end); on a line with right-to-left text the
 * visual boxes of its graphemes in the range, merged where they touch, left to right.
 *
 * @param layout - The laid-out text.
 * @param start - The range's start.
 * @param end - Its end.
 * @returns The spans; none for an empty range.
 */
export function selectionSpans(layout: TextLayout, start: number, end: number): SelectionSpan[] {
  if (start >= end) return [];
  const spans: SelectionSpan[] = [];
  const first = lineOf(layout, start);
  const last = lineOf(layout, end);
  for (let index = first; index <= last; index += 1) {
    const line = layout.lines[index];
    if (line === undefined) continue;
    if (isMixedLine(layout, index)) {
      spans.push(...mixedSpans(layout, index, start, end));
      continue;
    }
    const left = index === first ? caretRect(layout, start).x : line.x;
    const right = index === last ? caretRect(layout, end).x : line.x + line.width;
    if (right > left) spans.push({ line: index, left, right });
  }
  return spans;
}

/**
 * Where to draw the caret for an index.
 *
 * @param layout - The laid-out text.
 * @param index - A caret index.
 * @param extent - The caret's extent around the baseline (sized to a style); the whole line box
 *   when omitted.
 * @returns The caret's position and height.
 */
export function caretRect(layout: TextLayout, index: number, extent?: LineExtent): CaretRect {
  const line = lineAt(layout, lineOf(layout, index));
  const x = caretPlacement(layout, index).primary;
  if (extent === undefined) return { x, y: line.y, height: line.height };
  return { x, y: line.baseline - extent.ascent, height: extent.ascent + extent.descent };
}

/**
 * The caret index nearest an x on a line: before the first caret stop whose part's middle is right
 * of x. A cluster's stops are its graphemes, splitting its box evenly; a glyph per
 * codepoint is a cluster of one.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The line.
 * @param x - The x, in world units.
 * @returns The caret index.
 */
export function indexAtLine(layout: TextLayout, lineIndex: number, x: number): number {
  if (isMixedLine(layout, lineIndex)) return mixedIndexAtLine(layout, lineIndex, x);
  for (const cluster of clustersOnLine(layout, lineIndex)) {
    const part = cluster.width / cluster.stops.length;
    for (const [position, stop] of cluster.stops.entries()) {
      if (x < cluster.left + part * position + part / 2) return stop;
    }
  }
  return lineEndIndex(layout, lineIndex);
}

/**
 * The line whose box contains a y, clamped to the first and last lines.
 *
 * @param layout - The laid-out text.
 * @param y - The y, in world units.
 * @returns The line index.
 */
export function lineAtY(layout: TextLayout, y: number): number {
  let low = 0;
  let high = layout.lines.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    const line = lineAt(layout, middle);
    if (y < line.y + line.height) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * The caret index nearest a point in the box.
 *
 * @param layout - The laid-out text.
 * @param point - The point, in the box's frame.
 * @param point.x - Its x, in world units.
 * @param point.y - Its y, in world units.
 * @returns The caret index.
 */
export function hitTest(
  layout: TextLayout,
  point: { readonly x: number; readonly y: number },
): number {
  return indexAtLine(layout, lineAtY(layout, point.y), point.x);
}

/**
 * The caret index one grapheme over on screen: on a line with right-to-left text the
 * grapheme the caret crosses going left or right, whatever its direction in the text; off the
 * line's visual edge the line that edge leads to. Undefined on a left-to-right line, where the
 * text order is the screen order.
 *
 * @param layout - The laid-out text.
 * @param index - The caret index.
 * @param direction - −1 left, 1 right.
 * @returns The new caret index, or undefined on a left-to-right line.
 */
export function visualCaretStep(
  layout: TextLayout,
  index: number,
  direction: -1 | 1,
): number | undefined {
  const lineIndex = lineOf(layout, index);
  if (!isMixedLine(layout, lineIndex)) return undefined;
  return mixedVisualStep(layout, lineIndex, index, direction);
}

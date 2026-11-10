import type { TextLayout } from '@canvas/text';

import { clustersOnLine, lineAt, lineEndIndex } from './caret-clusters.js';
import type { CaretPlacement, SelectionSpan } from './caret.js';

// The caret on a line with right-to-left text: its glyphs run right to left inside an
// odd-level run, so the caret, hit testing and selection go by each grapheme's visual box and
// direction instead of assuming x grows with the index.

/** A grapheme as a mixed line's caret sees it: its text range, its level and its visual box. */
interface GraphemeBox {
  readonly start: number;
  readonly end: number;
  readonly level: number;
  readonly left: number;
  readonly right: number;
}

/** Each layout's lines with right-to-left text, found once. */
const mixedCache = new WeakMap<TextLayout, ReadonlySet<number>>();

/** Each layout's grapheme boxes by mixed line, built once. */
const boxCache = new WeakMap<TextLayout, Map<number, readonly GraphemeBox[]>>();

/**
 * Whether a line holds right-to-left text: a glyph at an odd bidi level.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The line.
 * @returns True for a mixed or right-to-left line.
 */
export function isMixedLine(layout: TextLayout, lineIndex: number): boolean {
  let lines = mixedCache.get(layout);
  if (lines === undefined) {
    const found = new Set<number>();
    for (const glyph of layout.glyphs) if (glyph.level % 2 === 1) found.add(glyph.line);
    lines = found;
    mixedCache.set(layout, lines);
  }
  return lines.has(lineIndex);
}

/**
 * The graphemes on a mixed line, in text order, each with its visual box: a cluster's box split
 * evenly between its graphemes, from the left in a left-to-right cluster and from the right in a
 * right-to-left one.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The line.
 * @returns The boxes.
 */
function graphemeBoxes(layout: TextLayout, lineIndex: number): readonly GraphemeBox[] {
  let byLine = boxCache.get(layout);
  if (byLine === undefined) {
    byLine = new Map();
    boxCache.set(layout, byLine);
  }
  const cached = byLine.get(lineIndex);
  if (cached !== undefined) return cached;
  const boxes: GraphemeBox[] = [];
  for (const cluster of clustersOnLine(layout, lineIndex)) {
    const isRtl = cluster.level % 2 === 1;
    const left = isRtl ? cluster.minX : cluster.left;
    const right = isRtl ? cluster.maxX : cluster.left + cluster.width;
    const part = (right - left) / cluster.stops.length;
    cluster.stops.forEach((start, position) => {
      const end = cluster.stops[position + 1] ?? cluster.end;
      const from = isRtl ? right - part * (position + 1) : left + part * position;
      boxes.push({ start, end, level: cluster.level, left: from, right: from + part });
    });
  }
  byLine.set(lineIndex, boxes);
  return boxes;
}

/**
 * A grapheme's edge before its text, in its direction.
 *
 * @param box - The grapheme.
 * @returns The x: its left in a left-to-right run, its right in a right-to-left one.
 */
function leadingEdge(box: GraphemeBox): number {
  return box.level % 2 === 1 ? box.right : box.left;
}

/**
 * A grapheme's edge after its text, in its direction.
 *
 * @param box - The grapheme.
 * @returns The x: its right in a left-to-right run, its left in a right-to-left one.
 */
function trailingEdge(box: GraphemeBox): number {
  return box.level % 2 === 1 ? box.left : box.right;
}

/**
 * Where a caret index draws on a mixed line: before the grapheme after it, else after the one
 * before it, split where the two run in different directions.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The index's line.
 * @param index - The caret index.
 * @returns The placement.
 */
export function mixedPlacement(
  layout: TextLayout,
  lineIndex: number,
  index: number,
): CaretPlacement {
  const boxes = graphemeBoxes(layout, lineIndex);
  const after = boxes.find(({ start }) => start === index);
  const before = boxes.find(({ end }) => end === index);
  const primary =
    after === undefined
      ? before === undefined
        ? lineAt(layout, lineIndex).x
        : trailingEdge(before)
      : leadingEdge(after);
  if (after === undefined || before === undefined || after.level === before.level) {
    return { primary };
  }
  const secondary = trailingEdge(before);
  return secondary === primary ? { primary } : { primary, secondary };
}

/**
 * The caret index nearest an x on a mixed line: in the grapheme under x, its start in its leading
 * half and its end in its trailing half; between graphemes (letter spacing) or past the line's
 * ends, the index at the nearest grapheme edge.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The line.
 * @param x - The x, in world units.
 * @returns The caret index, at most the line's visual end.
 */
export function mixedIndexAtLine(layout: TextLayout, lineIndex: number, x: number): number {
  const boxes = graphemeBoxes(layout, lineIndex);
  const lineEnd = lineEndIndex(layout, lineIndex);
  const box = boxes.find(({ left, right }) => left <= x && x < right);
  if (box !== undefined) {
    const middle = (box.left + box.right) / 2;
    const isLeading = box.level % 2 === 1 ? x >= middle : x < middle;
    return Math.min(isLeading ? box.start : box.end, lineEnd);
  }
  // Between boxes (letter spacing) or past the line's ends: the nearest grapheme edge.
  let nearest: { distance: number; index: number } | undefined;
  for (const candidate of boxes) {
    const isRtl = candidate.level % 2 === 1;
    for (const [edge, index] of [
      [candidate.left, isRtl ? candidate.end : candidate.start],
      [candidate.right, isRtl ? candidate.start : candidate.end],
    ] as const) {
      const distance = Math.abs(x - edge);
      if (nearest === undefined || distance < nearest.distance) nearest = { distance, index };
    }
  }
  return Math.min(nearest?.index ?? lineEnd, lineEnd);
}

/**
 * A mixed line's part of a range: the visual boxes of its graphemes in the range, merged where
 * they touch, left to right.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The line.
 * @param start - The range's start.
 * @param end - Its end.
 * @returns The spans.
 */
export function mixedSpans(
  layout: TextLayout,
  lineIndex: number,
  start: number,
  end: number,
): SelectionSpan[] {
  const inRange = graphemeBoxes(layout, lineIndex)
    .filter((box) => start <= box.start && box.start < end)
    .sort((a, b) => a.left - b.left);
  const spans: { line: number; left: number; right: number }[] = [];
  for (const { left, right } of inRange) {
    const last = spans.at(-1);
    if (last !== undefined && left <= last.right + 1e-9) last.right = Math.max(last.right, right);
    else spans.push({ line: lineIndex, left, right });
  }
  return spans;
}

/** A caret index and the x it holds in its line's visual order of carets. */
interface CaretSlot {
  readonly index: number;
  x: number;
}

/** Each layout's caret slots by mixed line, left to right, built once. */
const slotCache = new WeakMap<TextLayout, Map<number, readonly CaretSlot[]>>();

/**
 * Whether two caret x's are the same point (boxes are built by arithmetic).
 *
 * @param a - One x.
 * @param b - The other.
 * @returns True within a millionth of a unit.
 */
function isSameX(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/**
 * A mixed line's caret indices in screen order, left to right, each at one x: its primary, except
 * where two indices share a primary at a run boundary. There the lower of them that has a
 * secondary no index holds moves to it, so each visual boundary holds one index and repeated
 * arrows walk every one of them once.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The line, mixed.
 * @returns The slots, by x, then by index.
 */
function caretSlots(layout: TextLayout, lineIndex: number): readonly CaretSlot[] {
  let byLine = slotCache.get(layout);
  if (byLine === undefined) {
    byLine = new Map();
    slotCache.set(layout, byLine);
  }
  const cached = byLine.get(lineIndex);
  if (cached !== undefined) return cached;
  const lineEnd = lineEndIndex(layout, lineIndex);
  const indices = [
    ...new Set(graphemeBoxes(layout, lineIndex).flatMap(({ start, end }) => [start, end])),
  ]
    .filter((index) => index <= lineEnd)
    .sort((a, b) => a - b);
  const placements = indices.map((index) => mixedPlacement(layout, lineIndex, index));
  const slots: CaretSlot[] = indices.map((index, position) => ({
    index,
    x: placements[position]?.primary ?? 0,
  }));
  slots.forEach((slot, position) => {
    const secondary = placements[position]?.secondary;
    if (secondary === undefined) return;
    const isShared = slots.some((other) => other !== slot && isSameX(other.x, slot.x));
    const isFree = !slots.some((other) => isSameX(other.x, secondary));
    if (isShared && isFree) slot.x = secondary;
  });
  slots.sort((a, b) => (isSameX(a.x, b.x) ? a.index - b.index : a.x - b.x));
  byLine.set(lineIndex, slots);
  return slots;
}

/**
 * The caret index one grapheme over on screen from a caret on a mixed line: the next
 * of the line's caret slots to the left or right ({@link caretSlots}), so a run of key presses
 * walks the line's visual boundaries in order and never revisits one, even across a split caret.
 * Off a line's visual edge the caret goes to the line that edge leads to in reading order: off its
 * start edge (where its first grapheme reads from) the previous line's end, off its end edge the
 * next line's start, and stays at the text's first or last line.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The caret's line, mixed.
 * @param index - The caret index.
 * @param direction - −1 left, 1 right.
 * @returns The new caret index.
 */
export function mixedVisualStep(
  layout: TextLayout,
  lineIndex: number,
  index: number,
  direction: -1 | 1,
): number {
  const slots = caretSlots(layout, lineIndex);
  const position = slots.findIndex((slot) => slot.index === index);
  let next: CaretSlot | undefined;
  if (position === -1) {
    // Not a caret stop of the line (past its visual end): the next slot from where it draws.
    const x = mixedPlacement(layout, lineIndex, index).primary;
    next =
      direction > 0
        ? slots.find((slot) => slot.x > x)
        : [...slots].reverse().find((slot) => slot.x < x);
  } else {
    next = slots[position + direction];
  }
  if (next !== undefined) return next.index;
  const first = graphemeBoxes(layout, lineIndex)[0];
  // Off the edge the line's first grapheme reads from (its right in a right-to-left line).
  const isStartEdge = first !== undefined && (first.level % 2 === 1) === direction > 0;
  if (isStartEdge) {
    return lineIndex === 0 ? index : lineEndIndex(layout, lineIndex - 1);
  }
  return layout.lines[lineIndex + 1]?.start ?? index;
}

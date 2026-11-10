import { SPACE } from '@canvas/text';
import type { LayoutGlyph, LayoutLine, TextLayout } from '@canvas/text';

// The caret's clusters and lines over a TextLayout (split out of caret.ts for). Indices
// are UTF-16 caret positions (0 to text.length); coordinates are world units in the box's frame.

/**
 * A cluster as the caret sees it: glyphs on a line sharing `index`..`end`. Its box runs
 * from its first glyph's x for the sum of its advances, split evenly between its caret stops, its
 * graphemes, as when a font has no ligature caret positions.
 */
export interface CaretCluster {
  readonly start: number;
  readonly end: number;
  readonly left: number;
  readonly width: number;
  /** The UTF-16 index each grapheme starts at, in order. */
  readonly stops: readonly number[];
  /** Its first glyph's bidi level: odd reads right to left. */
  readonly level: number;
  /** The leftmost of its glyphs' boxes: an RTL cluster's first glyph is not its left. */
  readonly minX: number;
  /** The rightmost edge of its glyphs' boxes. */
  readonly maxX: number;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** A carriage return and a line feed, whose pair is one line break. */
const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;

/**
 * The grapheme starts of `text[start, end)`: just `start` for one codepoint.
 *
 * @param text - The text.
 * @param start - The cluster's first UTF-16 index.
 * @param end - One past its last.
 * @returns The stops.
 */
function stopsOf(text: string, start: number, end: number): number[] {
  const codepointLength = (text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1;
  if (end - start <= codepointLength) return [start];
  return [...graphemes.segment(text.slice(start, end))].map(({ index }) => start + index);
}

/** Each layout's caret clusters by line, built once: hit testing asks for them per pointer move. */
const clusterCache = new WeakMap<TextLayout, Map<number, readonly CaretCluster[]>>();

/**
 * The clusters on a line, in layout order, built once per layout and line.
 *
 * @param layout - The laid-out text; layouts are immutable, so the clusters are cached.
 * @param lineIndex - The line.
 * @returns Its clusters.
 */
export function clustersOnLine(layout: TextLayout, lineIndex: number): readonly CaretCluster[] {
  let byLine = clusterCache.get(layout);
  if (byLine === undefined) {
    byLine = new Map();
    clusterCache.set(layout, byLine);
  }
  let clusters = byLine.get(lineIndex);
  if (clusters === undefined) {
    clusters = buildClustersOnLine(layout, lineIndex);
    byLine.set(lineIndex, clusters);
  }
  return clusters;
}

/**
 * Builds the clusters on a line, in layout order.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The line.
 * @returns Its clusters.
 */
function buildClustersOnLine(layout: TextLayout, lineIndex: number): CaretCluster[] {
  const clusters: CaretCluster[] = [];
  let current:
    | {
        start: number;
        end: number;
        left: number;
        width: number;
        level: number;
        minX: number;
        maxX: number;
      }
    | undefined;
  let isShaped = false;
  let boundaries: ReadonlySet<number> | undefined;
  const close = () => {
    if (current !== undefined) {
      clusters.push({ ...current, stops: stopsOf(layout.text, current.start, current.end) });
    }
  };
  for (const glyph of layout.glyphs) {
    if (glyph.line !== lineIndex) continue;
    // A glyph of the cluster under way (or of one merged into it) widens it.
    if (current !== undefined && glyph.index >= current.start && glyph.end <= current.end) {
      current.width += glyph.advance;
      widen(current, glyph);
      continue;
    }
    // A shaped cluster that starts inside a grapheme (HarfBuzz may split an Indic conjunct the
    // grapheme rules keep whole) joins the one before it, so every caret stop is a grapheme
    // boundary, as the editor's caret steps are.
    if (glyph.glyphId !== null && isShaped && current?.end === glyph.index) {
      boundaries ??= graphemeBoundaries(layout, lineIndex);
      if (!boundaries.has(glyph.index)) {
        current.end = glyph.end;
        current.width += glyph.advance;
        widen(current, glyph);
        continue;
      }
    }
    close();
    isShaped = glyph.glyphId !== null;
    current = {
      start: glyph.index,
      end: glyph.end,
      left: glyph.x,
      width: glyph.advance,
      level: glyph.level,
      minX: glyph.x,
      maxX: glyph.x + glyph.advance,
    };
  }
  close();
  return clusters;
}

/**
 * Widens a cluster's visual extent by one of its glyphs.
 *
 * @param cluster - The cluster under way.
 * @param cluster.minX - Its leftmost edge so far.
 * @param cluster.maxX - Its rightmost edge so far.
 * @param glyph - The glyph.
 */
function widen(cluster: { minX: number; maxX: number }, glyph: LayoutGlyph): void {
  cluster.minX = Math.min(cluster.minX, glyph.x);
  cluster.maxX = Math.max(cluster.maxX, glyph.x + glyph.advance);
}

/**
 * The grapheme boundaries of a line's text.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The line.
 * @returns The UTF-16 index each of its graphemes starts at.
 */
function graphemeBoundaries(layout: TextLayout, lineIndex: number): ReadonlySet<number> {
  const line = lineAt(layout, lineIndex);
  const text = layout.text.slice(line.start, line.end);
  return new Set([...graphemes.segment(text)].map(({ index }) => line.start + index));
}

/**
 * The caret x of an index inside a shaped cluster (a ligature, a conjunct): its grapheme's share
 * of the cluster's box. Undefined when no shaped cluster on the line holds the index inside it.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The index's line.
 * @param index - A caret index.
 * @returns The x, or undefined.
 */
export function insideCluster(
  layout: TextLayout,
  lineIndex: number,
  index: number,
): number | undefined {
  const holder = layout.glyphs.find(
    (glyph) =>
      glyph.line === lineIndex &&
      glyph.glyphId !== null &&
      glyph.index < index &&
      index < glyph.end,
  );
  if (holder === undefined) return undefined;
  const cluster = clustersOnLine(layout, lineIndex).find(
    ({ start, end }) => start <= holder.index && holder.index < end,
  );
  if (cluster === undefined) return undefined;
  let before = 0;
  for (const stop of cluster.stops) if (stop <= index) before += 1;
  return cluster.left + (cluster.width * (before - 1)) / cluster.stops.length;
}

const EMPTY_LINE: LayoutLine = {
  start: 0,
  end: 0,
  isHard: true,
  x: 0,
  y: 0,
  height: 0,
  ascent: 0,
  descent: 0,
  baseline: 0,
  width: 0,
};

/**
 * A line of a layout, or an empty one past its lines.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The line.
 * @returns The line.
 */
export function lineAt(layout: TextLayout, lineIndex: number): LayoutLine {
  return layout.lines[lineIndex] ?? EMPTY_LINE;
}

/**
 * A caret index outside a CR LF line break: CR LF is one break, so the index between
 * its CR and LF is not a caret stop and stands for the one before the CR.
 *
 * @param text - The text.
 * @param index - A caret index.
 * @returns The index, or the one before the CR when it falls inside CR LF.
 */
export function outsideLineBreak(text: string, index: number): number {
  return text.charCodeAt(index - 1) === CARRIAGE_RETURN && text.charCodeAt(index) === LINE_FEED
    ? index - 1
    : index;
}

/**
 * The line a caret index sits on. A caret at a wrap point belongs to the next line; at a hard
 * line's end (its newline) it stays on that line.
 *
 * @param layout - The laid-out text.
 * @param index - A caret index.
 * @returns The line index; the last line for an index past the end.
 */
export function lineOf(layout: TextLayout, index: number): number {
  const stop = outsideLineBreak(layout.text, index);
  const lastLine = layout.lines.length - 1;
  const found = layout.lines.findIndex(
    (line, lineIndex) =>
      stop < line.end || (stop === line.end && (line.isHard || lineIndex === lastLine)),
  );
  return found >= 0 ? found : lastLine;
}

/**
 * The caret index that visually ends a line: before the space a soft line wrapped at.
 *
 * @param layout - The laid-out text.
 * @param lineIndex - The line.
 * @returns The caret index.
 */
export function lineEndIndex(layout: TextLayout, lineIndex: number): number {
  const line = lineAt(layout, lineIndex);
  const isEndingInWrapSpace =
    !line.isHard && line.end > line.start && layout.text.charCodeAt(line.end - 1) === SPACE;
  return isEndingInWrapSpace ? line.end - 1 : line.end;
}

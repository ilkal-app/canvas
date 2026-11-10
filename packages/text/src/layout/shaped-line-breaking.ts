// Line breaking over shaped text: each segment, a stretch between hard breaks of runs
// sharing a face and a size, is shaped once by HarfBuzz; its glyphs are grouped into clusters,
// which are walked in logical order with today's rule (wrap after the last space when the next
// cluster overflows; a word longer than the line breaks between graphemes, never inside one). A
// line that cuts a segment where HarfBuzz flagged the glyph unsafe to break has the cut sides
// shaped again on their own, as HarfBuzz's documentation describes for line breaking. Glyphs are
// placed in visual order: a right-to-left segment's glyphs run left to right in buffer order.

import { ALLOWED_BREAK, lineBreakKinds, MANDATORY_BREAK } from '../line-break/line-breaks.js';
import type { ShapedRun } from '../shaping/shaper.js';
import type { TextDirection } from '../shaping/text-direction.js';

import { orderLine } from './bidi-line.js';
import { codepointAt } from './codepoints.js';
import type { BreakingRun, BrokenLine, PlacedGlyph } from './line-breaking.js';
import { noIndent } from './list-layout.js';
import type { RunCursor } from './run-cursor.js';
import { clustersOf, graphemeStarts, type Cluster } from './shaped-clusters.js';
import {
  directionOf,
  positionOf,
  type Segment,
  segmentHolding,
  segmentsOf,
} from './shaped-segments.js';
import { textBidi, type TextBidi } from './text-bidi.js';
import type { TextBaseDirection } from './text-layout.js';

/**
 * Shapes `text[start, end)` with a face, in em, in a direction or as guessed, at variable-font
 * coordinates or the face's defaults, in a language if given, with OpenType
 * feature settings if given; the measurer's own.
 */
export type SegmentShaper = (
  faceId: string,
  text: string,
  start: number,
  end: number,
  direction?: TextDirection,
  variations?: Readonly<Record<string, number>>,
  language?: string,
  features?: Readonly<Record<string, number>>,
) => ShapedRun;

/** A line's cut of one segment: the clusters it placed, in logical order. */
interface Piece {
  readonly segment: Segment;
  /** Its first UTF-16 index. */
  readonly start: number;
  /** One past its last. */
  end: number;
  clusters: Cluster[];
}

/** A segment shaped: its run and its clusters in logical order. */
interface ShapedSegment {
  readonly run: ShapedRun;
  readonly clusters: readonly Cluster[];
}

/** Breaks shaped text into lines and places its glyphs. */
class ShapedLineBreaker {
  readonly glyphs: PlacedGlyph[] = [];
  readonly lines: BrokenLine[] = [];
  private readonly shapedSegments = new Map<Segment, ShapedSegment>();
  private graphemeStarts: ReadonlySet<number> | undefined;
  /** What may happen before each index (UAX #14). */
  private readonly kinds: Uint8Array;
  /** The text's bidi levels, or `undefined` when it is left to right throughout. */
  readonly bidi: TextBidi | undefined;

  constructor(
    private readonly text: string,
    private readonly cursor: RunCursor<BreakingRun>,
    private readonly maxWidth: number | null,
    private readonly shape: SegmentShaper,
    direction: TextBaseDirection,
    private readonly indentAt: (lineStart: number) => number,
  ) {
    this.kinds = lineBreakKinds(text);
    this.bidi = textBidi(text, direction);
  }

  /** Lays every line out. */
  breakAll(): void {
    const segments = segmentsOf(this.text, this.cursor, this.bidi?.levels);
    // The line under construction: the clusters placed since its start, and its break point.
    let lineStart = 0;
    let x = 0;
    let pieces: Piece[] = [];
    let lastBreak: { index: number; pieceCount: number; clusterCount: number } | undefined;
    const flushTo = (end: number, isHard: boolean, nextStart: number) => {
      this.placeLine(pieces, lineStart, end, isHard);
      lineStart = nextStart;
      x = 0;
      pieces = [];
      lastBreak = undefined;
    };
    let segmentIndex = 0;
    let index = 0;
    while (index < this.text.length || segmentIndex < segments.length) {
      const segment = segments[segmentIndex];
      // Hard breaks between here and the next segment end their lines.
      const nextStart = segment?.start ?? this.text.length;
      for (const [end, next] of this.hardBreaks(index, nextStart)) flushTo(end, true, next);
      index = Math.max(index, nextStart);
      if (segment === undefined) break;
      let isWrapped = false;
      const { clusters } = this.shaped(segment);
      // Walk from the cluster at the index: the segment's first, or a wrap's restart.
      let position = positionOf(clusters, index);
      let cluster = clusters[position];
      while (cluster !== undefined) {
        const spacing = this.cursor.at(cluster.start).value.run.letterSpacing ?? 0;
        if (this.wrapsBefore(segment, cluster, x, lineStart, lastBreak)) {
          if (lastBreak !== undefined && lastBreak.index > lineStart) {
            // Back to the last space: the pieces and clusters placed up to it stay.
            const { pieceCount, clusterCount } = lastBreak;
            index = lastBreak.index;
            pieces = pieces.slice(0, pieceCount);
            const kept = pieces.at(-1);
            if (kept !== undefined) {
              kept.clusters = kept.clusters.slice(0, clusterCount);
              kept.end = index;
            }
          } else {
            index = cluster.start;
          }
          flushTo(index, false, index);
          isWrapped = true;
          break;
        }
        let piece = pieces.at(-1);
        if (piece?.segment !== segment) {
          piece = { segment, start: cluster.start, end: cluster.end, clusters: [] };
          pieces.push(piece);
        }
        piece.clusters.push(cluster);
        piece.end = cluster.end;
        x += cluster.width + spacing;
        if (this.kinds[cluster.end] === ALLOWED_BREAK) {
          lastBreak = {
            index: cluster.end,
            pieceCount: pieces.length,
            clusterCount: piece.clusters.length,
          };
        }
        index = cluster.end;
        position += 1;
        cluster = clusters[position];
      }
      // After a wrap, walk on from the segment holding the restart, which may be an earlier one.
      segmentIndex = isWrapped ? segmentHolding(segments, index) : segmentIndex + 1;
    }
    flushTo(this.text.length, true, this.text.length);
  }

  /**
   * The hard breaks between two segments: each line terminator, or CR LF, ends its line after
   * itself (UAX #14 LB4, LB5). Segments hold every other character, so the gap holds only line
   * terminators.
   *
   * @param from - The first UTF-16 index after the last segment.
   * @param to - The next segment's start.
   * @returns Each break's line end (its terminator's start) and the next line's start.
   */
  private hardBreaks(from: number, to: number): [end: number, next: number][] {
    const breaks: [end: number, next: number][] = [];
    let start = -1;
    for (let index = from; index < to; index += 1) {
      if (start < 0) start = index;
      if (this.kinds[index + 1] === MANDATORY_BREAK) {
        breaks.push([start, index + 1]);
        start = -1;
      }
    }
    return breaks;
  }

  /**
   * Whether the line wraps before a cluster: it overflows, and the line can end at its last
   * space or, for a word longer than the line, before this cluster because a grapheme starts
   * there.
   *
   * @param segment - The cluster's segment.
   * @param cluster - The cluster.
   * @param x - The line's width so far, px.
   * @param lineStart - The line's first UTF-16 index.
   * @param lastBreak - The line's last space break, if any.
   * @returns True when the line ends before the cluster.
   */
  private wrapsBefore(
    segment: Segment,
    cluster: Cluster,
    x: number,
    lineStart: number,
    lastBreak: { readonly index: number } | undefined,
  ): boolean {
    if (this.maxWidth === null) return false;
    if (x + cluster.width <= this.maxWidth - this.indentAt(lineStart)) return false;
    if (cluster.start <= lineStart || cluster.isSpace) return false;
    if (lastBreak !== undefined && lastBreak.index > lineStart) return true;
    return this.isGraphemeStart(cluster.start);
  }

  /**
   * Whether a UTF-16 index starts a grapheme. The whole text is segmented, since a style change
   * (a new segment) can fall inside a grapheme, as between a letter and its combining accent. It
   * is segmented once, and only when a word longer than the line needs a cut, since segmenting
   * every text would cost more than shaping it.
   *
   * @param index - The index.
   * @returns True when a grapheme starts there.
   */
  private isGraphemeStart(index: number): boolean {
    this.graphemeStarts ??= graphemeStarts(this.text, 0, this.text.length);
    return this.graphemeStarts.has(index);
  }

  /**
   * Shapes a stretch of a segment as the segment is shaped: its face, direction, coordinates,
   * language and feature settings.
   *
   * @param segment - The segment.
   * @param start - The first UTF-16 index to shape.
   * @param end - One past the last.
   * @returns The shaped run.
   */
  private shapeOf(segment: Segment, start: number, end: number): ShapedRun {
    const { faceId, variations, lang, fontFeatures } = segment;
    const direction = directionOf(segment);
    return this.shape(faceId, this.text, start, end, direction, variations, lang, fontFeatures);
  }

  /**
   * A segment shaped, once.
   *
   * @param segment - The segment.
   * @returns Its shaped run and clusters.
   */
  private shaped(segment: Segment): ShapedSegment {
    let shaped = this.shapedSegments.get(segment);
    if (shaped === undefined) {
      const run = this.shapeOf(segment, segment.start, segment.end);
      shaped = {
        run,
        clusters: clustersOf(this.text, run, segment.start, segment.end, segment.fontSize),
      };
      this.shapedSegments.set(segment, shaped);
    }
    return shaped;
  }

  /**
   * Places a line's glyphs, shaping a cut segment's piece again when the cut is unsafe.
   *
   * @param pieces - The line's clusters, per segment, in logical order.
   * @param start - The line's first UTF-16 index.
   * @param end - One past its last.
   * @param isHard - Whether a hard break ends it.
   */
  private placeLine(pieces: readonly Piece[], start: number, end: number, isHard: boolean): void {
    const line = this.lines.length;
    // The line's clusters in logical order, each with its segment, then in visual order: as they
    // are for left-to-right text, else by the bidi algorithm's L1 and L2.
    const logical = pieces.flatMap((piece) => {
      const { visual, direction } = this.pieceClusters(piece);
      const clusters = direction === 'rtl' ? [...visual].reverse() : visual;
      return clusters.map((cluster) => ({ cluster, segment: piece.segment }));
    });
    const ordered =
      this.bidi === undefined
        ? { items: logical, levels: undefined }
        : orderLine(this.text, logical, this.bidi, start);
    // A soft line's trailing spaces hang past its end: on the right in a left-to-right paragraph,
    // where alignment leaves them out; on the left in a right-to-left one, before x 0, so the
    // line's other glyphs start at 0.
    const paragraphLevel = this.bidi?.paragraphLevels[start] ?? 0;
    const isHangingLeft = !isHard && paragraphLevel % 2 === 1;
    let x = isHangingLeft ? -this.hangingWidth(ordered.items.map(({ cluster }) => cluster)) : 0;
    let trailing = 0;
    for (const [position, { cluster, segment }] of ordered.items.entries()) {
      const { run, index: runIndex } = this.runAt(cluster.start);
      const codepoint = codepointAt(this.text, cluster.start).codepoint;
      const level = ordered.levels?.[position] ?? 0;
      for (const glyph of cluster.glyphs) {
        const advance = glyph.advance * segment.fontSize;
        this.glyphs.push({
          codepoint,
          index: cluster.start,
          end: cluster.end,
          glyphId: glyph.glyphId,
          level,
          line,
          x: x + glyph.xOffset * segment.fontSize,
          yOffset: glyph.yOffset * segment.fontSize,
          advance,
          run: runIndex,
        });
        x += advance;
      }
      trailing = run.letterSpacing ?? 0;
      x += trailing;
    }
    this.lines.push({ start, end, isHard, width: x - trailing });
  }

  /**
   * The width of the spaces a right-to-left line ends with: its first clusters in visual order.
   *
   * @param visual - The line's clusters, in visual order.
   * @returns Their advances and letter spacing, in px.
   */
  private hangingWidth(visual: readonly Cluster[]): number {
    let width = 0;
    for (const cluster of visual) {
      if (!cluster.isSpace) break;
      width += cluster.width + (this.runAt(cluster.start).run.letterSpacing ?? 0);
    }
    return width;
  }

  /**
   * A piece's clusters in visual order: as shaped with its segment, or shaped again on its own
   * when the line cut the segment where HarfBuzz flagged a glyph unsafe to break.
   *
   * @param piece - The piece, with its clusters from the segment's shaping.
   * @returns The clusters, in visual order, and the direction they were shaped in.
   */
  private pieceClusters(piece: Piece): { visual: Cluster[]; direction: TextDirection } {
    const { segment, clusters } = piece;
    const whole = this.shaped(segment);
    // HarfBuzz flags a cluster unsafe to break when cutting the text at its start may change the
    // shaping: the piece's first cluster for the cut before it, the next cluster for the cut after.
    const isCutBefore = piece.start > segment.start;
    const isCutAfter = piece.end < segment.end;
    const isUnsafeAt = (index: number) => {
      const cluster = whole.clusters[positionOf(whole.clusters, index)];
      return cluster?.start === index && cluster.isUnsafeToBreak;
    };
    const isUnsafe =
      (isCutBefore && isUnsafeAt(piece.start)) || (isCutAfter && isUnsafeAt(piece.end));
    let logical: readonly Cluster[] = clusters;
    let direction = whole.run.direction;
    if (isUnsafe) {
      const run = this.shapeOf(segment, piece.start, piece.end);
      logical = clustersOf(this.text, run, piece.start, piece.end, segment.fontSize);
      direction = run.direction;
    }
    const visual = direction === 'rtl' ? [...logical].reverse() : [...logical];
    return { visual, direction };
  }

  /**
   * The style run at an index.
   *
   * @param index - A UTF-16 index.
   * @returns The run and its index among the runs.
   */
  private runAt(index: number): { run: BreakingRun['run']; index: number } {
    const span = this.cursor.at(index);
    return { run: span.value.run, index: span.index };
  }
}

/**
 * Breaks shaped text into lines and places its glyphs in visual order. Pure.
 *
 * @param text - The text.
 * @param cursor - The style runs.
 * @param maxWidth - The wrap width, or null for no wrapping.
 * @param shape - Shapes a stretch with a face.
 * @param direction - The text's base direction. Default `auto`.
 * @param indentAt - How far a line starting at an index is indented (a list paragraph's
 *   hanging indent), which it wraps within; none by default.
 * @returns The glyphs and lines, and each UTF-16 index's paragraph level when the text has bidi
 *   levels.
 */
export function breakShapedLines(
  text: string,
  cursor: RunCursor<BreakingRun>,
  maxWidth: number | null,
  shape: SegmentShaper,
  direction: TextBaseDirection = 'auto',
  indentAt: (lineStart: number) => number = noIndent,
): {
  readonly glyphs: readonly PlacedGlyph[];
  readonly lines: readonly BrokenLine[];
  readonly paragraphLevels?: Uint8Array;
} {
  const breaker = new ShapedLineBreaker(text, cursor, maxWidth, shape, direction, indentAt);
  breaker.breakAll();
  const paragraphLevels = breaker.bidi?.paragraphLevels;
  return {
    glyphs: breaker.glyphs,
    lines: breaker.lines,
    ...(paragraphLevels === undefined ? {} : { paragraphLevels }),
  };
}

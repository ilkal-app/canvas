import {
  ALLOWED_BREAK,
  isLineTerminator,
  lineBreakKinds,
  MANDATORY_BREAK,
} from '../line-break/line-breaks.js';

import { codepointAt, SPACE } from './codepoints.js';
import type { GlyphMeasurer } from './glyph-measurer.js';
import { noIndent } from './list-layout.js';
import type { RunCursor } from './run-cursor.js';
import type { LayoutRun } from './text-layout.js';

/** A run as line breaking needs it. */
export interface BreakingRun {
  /** The resolved run. */
  readonly run: LayoutRun;
  /** Glyphs kern only with a neighbour of the same face and size; colour does not matter. */
  readonly kerningGroup: string;
}

/** A glyph placed by line breaking, before its baseline and alignment are known. */
export interface PlacedGlyph {
  /** The Unicode codepoint. */
  readonly codepoint: number;
  /** Its index in the text, in UTF-16 code units: its cluster's first character. */
  readonly index: number;
  /** One past its cluster's last character, in UTF-16 code units. */
  readonly end: number;
  /** The glyph's id in its font when shaped; null when measured per codepoint. */
  readonly glyphId: number | null;
  /** Its bidi embedding level after rule L1; 0 on this left-to-right path. */
  readonly level: number;
  /** The line it landed on. */
  readonly line: number;
  /** The pen x from the line's start, in world units. */
  readonly x: number;
  /** The shaped offset above the baseline, in world units; 0 per codepoint. */
  readonly yOffset: number;
  /** The advance, in world units. */
  readonly advance: number;
  /** The index of its run. */
  readonly run: number;
}

/** A line as line breaking leaves it: its span and width, before metrics and alignment. */
export interface BrokenLine {
  /** Index of the first character. */
  readonly start: number;
  /** Exclusive end; for a hard line, the index of its newline or the text length. */
  readonly end: number;
  /** Whether a newline or the end of the text ends it. */
  readonly isHard: boolean;
  /** The pen advance of the line, trailing spaces included, its last letter-spacing not. */
  readonly width: number;
}

/**
 * Greedy line breaking over runs (the first pass of the prototype's `layoutText`,
 * `src/text/layout.ts`): a line wraps before the character that would cross `maxWidth`, at the
 * line's last break opportunity by UAX #14 if it has one (spaces before it stay on the
 * line and hang past the width), else before that character. Spaces never wrap, and a line
 * terminator (LF, CR LF, CR, NEL, VT, FF, LS, PS) ends its line. Wrapping rewinds to the break, so the walk moves
 * both ways through the text. A run's letter-spacing moves the pen after each of its
 * characters; a character fits when its own advance does, and a line's width leaves out its last
 * character's spacing, so tracking is trimmed at line ends.
 */
class LineBreaker {
  readonly glyphs: PlacedGlyph[] = [];
  readonly lines: BrokenLine[] = [];
  private lineStart = 0;
  private x = 0;
  private previous: { readonly codepoint: number; readonly kerningGroup: string } | undefined;
  /** What may happen before each index (UAX #14). */
  private readonly kinds: Uint8Array;
  /** The first character of the line terminator being read (CR of a CR LF), or -1. */
  private terminatorStart = -1;
  /** Index of the line's last break opportunity, or -1 when it has none. */
  private lastBreak = -1;
  private lastBreakX = 0;
  private lastBreakGlyphCount = 0;
  /** The letter-spacing after the line's last character, left out of its width. */
  private trailing = 0;
  private lastBreakTrailing = 0;

  constructor(
    private readonly text: string,
    private readonly cursor: RunCursor<BreakingRun>,
    private readonly maxWidth: number | null,
    private readonly measurer: GlyphMeasurer,
    private readonly indentAt: (lineStart: number) => number,
  ) {
    this.kinds = lineBreakKinds(text);
  }

  breakAll(): void {
    let index = 0;
    while (index < this.text.length) index = this.place(index);
    this.flush(this.text.length, true, this.text.length);
  }

  /**
   * Places one character, or wraps before it.
   *
   * @param index - The character's UTF-16 index.
   * @returns The index to place next.
   */
  private place(index: number): number {
    const { codepoint, length } = codepointAt(this.text, index);
    if (isLineTerminator(codepoint)) {
      // A terminator draws nothing; the line ends after it (after the LF of a CR LF).
      if (this.terminatorStart < 0) this.terminatorStart = index;
      if (this.kinds[index + length] === MANDATORY_BREAK) {
        this.flush(this.terminatorStart, true, index + length);
        this.terminatorStart = -1;
      }
      return index + length;
    }
    const span = this.cursor.at(index);
    const { run, kerningGroup } = span.value;
    const kerning =
      this.previous?.kerningGroup === kerningGroup
        ? this.measurer.kerning(run.faceId, this.previous.codepoint, codepoint) * run.fontSize
        : 0;
    const advance = this.measurer.advance(run.faceId, codepoint) * run.fontSize;
    const x = this.x + kerning;
    const isOverflowing =
      this.maxWidth !== null && x + advance > this.maxWidth - this.indentAt(this.lineStart);
    if (isOverflowing && index > this.lineStart && codepoint !== SPACE) return this.wrap(index);
    this.glyphs.push({
      codepoint,
      index,
      end: index + length,
      glyphId: null,
      level: 0,
      line: this.lines.length,
      x,
      yOffset: 0,
      advance,
      run: span.index,
    });
    this.trailing = run.letterSpacing ?? 0;
    this.x = x + advance + this.trailing;
    this.previous = { codepoint, kerningGroup };
    if (this.kinds[index + length] === ALLOWED_BREAK) {
      this.lastBreak = index + length;
      this.lastBreakX = this.x;
      this.lastBreakGlyphCount = this.glyphs.length;
      this.lastBreakTrailing = this.trailing;
    }
    return index + length;
  }

  /**
   * Ends the line before a character that does not fit: at the line's last break opportunity
   * when it has one (dropping the glyphs placed since), else right before the character.
   *
   * @param index - The character that does not fit.
   * @returns The index the next line starts at.
   */
  private wrap(index: number): number {
    if (this.lastBreak > this.lineStart) {
      const restart = this.lastBreak;
      this.glyphs.length = this.lastBreakGlyphCount;
      this.x = this.lastBreakX;
      this.trailing = this.lastBreakTrailing;
      this.flush(restart, false, restart);
      return restart;
    }
    this.flush(index, false, index);
    return index;
  }

  private flush(end: number, isHard: boolean, nextStart: number): void {
    this.lines.push({ start: this.lineStart, end, isHard, width: this.x - this.trailing });
    this.lineStart = nextStart;
    this.x = 0;
    this.trailing = 0;
    this.lastBreakTrailing = 0;
    this.previous = undefined;
    this.lastBreak = -1;
    this.lastBreakX = 0;
    this.lastBreakGlyphCount = 0;
  }
}

/**
 * Breaks text into lines and places each glyph's pen x along its line.
 *
 * @param text - The text.
 * @param cursor - The text's runs.
 * @param maxWidth - The wrapping width, in world units; `null` wraps only at newlines.
 * @param measurer - Advances and kerning.
 * @param indentAt - How far a line starting at an index is indented (a list paragraph's
 *   hanging indent), which it wraps within; none by default.
 * @returns The placed glyphs, in text order, and the lines.
 */
export function breakLines(
  text: string,
  cursor: RunCursor<BreakingRun>,
  maxWidth: number | null,
  measurer: GlyphMeasurer,
  indentAt: (lineStart: number) => number = noIndent,
): { readonly glyphs: readonly PlacedGlyph[]; readonly lines: readonly BrokenLine[] } {
  const breaker = new LineBreaker(text, cursor, maxWidth, measurer, indentAt);
  breaker.breakAll();
  return { glyphs: breaker.glyphs, lines: breaker.lines };
}

import type { INK, Rgba, TEXT_ALIGNS, TEXT_DIRECTIONS, TokenRef } from '@canvas/schema';

/** Horizontal alignment of lines in a text box: the schema's `align` field. */
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/**
 * A text box's base direction, the schema's `direction` field: `auto` takes each
 * paragraph's from its first strong character; `ltr` and `rtl` set every paragraph's.
 */
export type TextBaseDirection = (typeof TEXT_DIRECTIONS)[number];

/**
 * The height of a line box as a multiple of its tallest run's font size, split into equal
 * half-leading above the ascent and below the descent (the prototype's `LINE_HEIGHT_EM`).
 */
export const LINE_HEIGHT_EM = 1.25;

/** A style run resolved for layout and rendering: the face it draws with, its size, its colour. */
export interface LayoutRun {
  /** The loaded face that draws the run (a `fontFaceId`), after fallbacks. */
  readonly faceId: string;
  /** The font size, in world units (px at zoom 1). */
  readonly fontSize: number;
  /**
   * The glyph colour, straight alpha, `'ink'` or a colour token reference,
   * which the text pass resolves in the object's colour mode when it writes records,
   * so a theme switch or a token edit needs no new layout. An unreadable stored colour is the
   * base colour here (`readInkable`).
   */
  readonly color: Rgba | typeof INK | TokenRef;
  /**
   * Extra space after each character, in world units (a percent of the font size
   * resolved); absent for none. Trimmed after a line's last character.
   */
  readonly letterSpacing?: number;
  /** The line box height, in world units; absent for auto ({@link LINE_HEIGHT_EM}). */
  readonly lineHeight?: number;
  /**
   * The variable-font coordinates the run was shaped at, normalised against its face's axes:
   * what it must be drawn at too. Absent for a face's defaults, a static face, and
   * every run a measurer that does not shape lays out.
   */
  readonly variations?: Readonly<Record<string, number>>;
  /** The run's language, a BCP 47 tag, which the shaper is told; absent for none. */
  readonly lang?: string;
  /**
   * The run's OpenType feature settings, which the shaper is told; absent for none. A
   * measurer that does not shape ignores them.
   */
  readonly fontFeatures?: Readonly<Record<string, number>>;
  /**
   * Present, `true`, when the run carries a link: it draws underlined, and in the
   * `accent` token when its colour is `'ink'`. The URL stays in the document; layout never needs
   * it, and the link moves no glyph.
   */
  readonly isLink?: true;
  /** Present, `true`, when the run is underlined. */
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the style field's name
  readonly underline?: true;
  /** Present, `true`, when the run is struck through. */
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the style field's name
  readonly strikethrough?: true;
}

/** One positioned character. Whitespace other than newlines gets a glyph too; it draws nothing. */
export interface LayoutGlyph {
  /** The Unicode codepoint: of its cluster's first character, when shaped. */
  readonly codepoint: number;
  /**
   * Its index in the source text, in UTF-16 code units: of its cluster's first character, when
   * shaped. A ligature or a cluster of several glyphs shares one index..end.
   */
  readonly index: number;
  /** One past its cluster's last character, in UTF-16 code units. */
  readonly end: number;
  /** The glyph's id in its font when shaped; null when measured per codepoint. */
  readonly glyphId: number | null;
  /**
   * Its bidi embedding level after rule L1: even reads left to right, odd right to
   * left; 0 for left-to-right text and on the per-codepoint path.
   */
  readonly level: number;
  /** The line it sits on. */
  readonly line: number;
  /** The glyph's x, in world units from the box's left edge (alignment and shaped offset included). */
  readonly x: number;
  /** The glyph's baseline y, in world units from the box's top edge (shaped offset included). */
  readonly y: number;
  /** The advance, in world units. */
  readonly advance: number;
  /** Its run, an index into {@link TextLayout.runs}. */
  readonly run: number;
}

/** One line of laid-out text. */
export interface LayoutLine {
  /** Index of its first character, in UTF-16 code units. */
  readonly start: number;
  /** Exclusive end; for a hard line, the index of its newline (or the text length). */
  readonly end: number;
  /** Whether a newline or the end of the text ends it; `false` when it wrapped. */
  readonly isHard: boolean;
  /** Left offset of the line in the box, in world units (0 unless centred or right-aligned). */
  readonly x: number;
  /** Top of the line box, in world units. */
  readonly y: number;
  /** Height of the line box, in world units: `ascent + descent`. */
  readonly height: number;
  /** From the top of the line box to the baseline: the tallest run's, half-leading included. */
  readonly ascent: number;
  /** From the baseline to the bottom of the line box, half-leading included. */
  readonly descent: number;
  /** The baseline's y, in world units from the box's top edge. */
  readonly baseline: number;
  /** The pen advance of the whole line, trailing spaces included, in world units. */
  readonly width: number;
}

/** The marker drawn before a list paragraph's first line. */
export interface LayoutMarker {
  /** The paragraph's index: the number of newlines before it. */
  readonly paragraph: number;
  /** The paragraph's first line. */
  readonly line: number;
  /** The marker: a bullet, or a number such as `1.`, `a.` or `iv.`. */
  readonly text: string;
  /** Its left edge, in world units from the box's left edge. */
  readonly x: number;
  /** Its baseline: the first line's. */
  readonly baseline: number;
  /** Its width: its characters' advances in its run's face and size. */
  readonly width: number;
  /** The run it is drawn in: the one at the paragraph's start, an index into the runs. */
  readonly run: number;
  /**
   * Its glyphs, placed in the box's frame like the text's (shaped in the run's face when the
   * measurer shapes), each giving the paragraph's start as its index. Not in `glyphs`: a marker
   * is drawn, never edited.
   */
  readonly glyphs: readonly LayoutGlyph[];
}

/** One underline or strikethrough segment, a horizontal bar. */
export interface LayoutDecoration {
  /** Which line it draws. */
  readonly kind: 'underline' | 'strikethrough';
  /** The text line it sits on. */
  readonly line: number;
  /** The run it belongs to, which gives its colour. */
  readonly run: number;
  /** Its left edge, in world units from the box's left edge. */
  readonly x: number;
  /** Its length. */
  readonly width: number;
  /** Its centre's y, in world units from the box's top edge. */
  readonly y: number;
  /** Its thickness. */
  readonly thickness: number;
}

/**
 * Text laid out into lines of positioned glyphs (the prototype's `TextLayout`,
 * `src/text/layout.ts`). All lengths are in world units in the box's frame: x right from its
 * left edge, y down from its top edge.
 */
export interface TextLayout {
  /** The source text. */
  readonly text: string;
  /** The resolved runs, one per source style run. */
  readonly runs: readonly LayoutRun[];
  /** Every character but newlines, in text order. */
  readonly glyphs: readonly LayoutGlyph[];
  /** The lines, top to bottom; empty text has one empty line. */
  readonly lines: readonly LayoutLine[];
  /** The widest line's width. */
  readonly width: number;
  /** The sum of the line heights. */
  readonly height: number;
  /**
   * One marker per list paragraph, in paragraph order. `layoutText` always sets it;
   * absent on a layout built elsewhere, which then has no lists.
   */
  readonly markers?: readonly LayoutMarker[];
  /**
   * Underline and strikethrough segments, line by line. `layoutText` always sets it;
   * absent on a layout built elsewhere, which then has none.
   */
  readonly decorations?: readonly LayoutDecoration[];
}

/** A caret: a vertical bar at `x` from `y` down `height`, in the box's frame. */
export interface CaretRect {
  /** Its x, in world units. */
  readonly x: number;
  /** Its top, in world units. */
  readonly y: number;
  /** Its height, in world units. */
  readonly height: number;
}

/** A line box's extent around its baseline, in world units. */
export interface LineExtent {
  /** Above the baseline, half-leading included. */
  readonly ascent: number;
  /** Below the baseline, half-leading included. */
  readonly descent: number;
}

import type {
  LayoutDecoration,
  LayoutGlyph,
  LayoutLine,
  LayoutMarker,
  LayoutRun,
  TextLayout,
} from '@canvas/text';

/**
 * Float64 fields per glyph: codepoint, index, line, x, y, advance, run, end, glyph id,
 * bidi level.
 */
const GLYPH_FIELDS = 10;
/** The packed glyph id of a glyph measured per codepoint, which has none. */
const NO_GLYPH_ID = -1;
/** Float64 fields per line: start, end, isHard, x, y, height, ascent, descent, baseline, width. */
const LINE_FIELDS = 10;
const BYTES_PER_FIELD = 8;

/**
 * A {@link TextLayout} as a `layout` job returns it from a worker: glyphs and lines packed into
 * two buffers of little-endian float64 fields, which cross threads by transfer instead of by
 * cloning one object per glyph. Float64 keeps every value exact.
 */
export interface PackedTextLayout {
  /** The source text. */
  readonly text: string;
  /** The resolved runs (few, so plain objects). */
  readonly runs: readonly LayoutRun[];
  /** Ten float64 fields per glyph (its cluster's end and glyph id: its level). */
  readonly glyphs: ArrayBuffer;
  /** Ten float64 fields per line. */
  readonly lines: ArrayBuffer;
  /** The widest line's width, in world units. */
  readonly width: number;
  /** The laid-out height, in world units. */
  readonly height: number;
  /** List markers: few, so plain objects, cloned. */
  readonly markers: readonly LayoutMarker[];
  /** Underline and strikethrough segments: few, so plain objects, cloned. */
  readonly decorations: readonly LayoutDecoration[];
}

/**
 * Packs a layout for transfer.
 *
 * @param layout - The layout; not changed.
 * @returns The packed layout; its two buffers are new and may be transferred.
 */
export function packTextLayout(layout: TextLayout): PackedTextLayout {
  // Field by field, with no array per glyph: a 1k-paragraph job packs 330k glyphs.
  const glyphs = new DataView(
    new ArrayBuffer(layout.glyphs.length * GLYPH_FIELDS * BYTES_PER_FIELD),
  );
  let at = 0;
  for (const glyph of layout.glyphs) {
    glyphs.setFloat64(at, glyph.codepoint, true);
    glyphs.setFloat64(at + 8, glyph.index, true);
    glyphs.setFloat64(at + 16, glyph.line, true);
    glyphs.setFloat64(at + 24, glyph.x, true);
    glyphs.setFloat64(at + 32, glyph.y, true);
    glyphs.setFloat64(at + 40, glyph.advance, true);
    glyphs.setFloat64(at + 48, glyph.run, true);
    glyphs.setFloat64(at + 56, glyph.end, true);
    glyphs.setFloat64(at + 64, glyph.glyphId ?? NO_GLYPH_ID, true);
    glyphs.setFloat64(at + 72, glyph.level, true);
    at += GLYPH_FIELDS * BYTES_PER_FIELD;
  }
  const lines = new DataView(new ArrayBuffer(layout.lines.length * LINE_FIELDS * BYTES_PER_FIELD));
  layout.lines.forEach((line, index) => {
    const fields = [
      line.start,
      line.end,
      line.isHard ? 1 : 0,
      line.x,
      line.y,
      line.height,
      line.ascent,
      line.descent,
      line.baseline,
      line.width,
    ];
    writeFields(lines, index * LINE_FIELDS, fields);
  });
  const { text, runs, width, height, markers = [], decorations = [] } = layout;
  const buffers = { glyphs: glyphs.buffer, lines: lines.buffer };
  return { text, runs, ...buffers, width, height, markers, decorations };
}

/**
 * Unpacks a layout a `layout` job returned.
 *
 * @param packed - The packed layout.
 * @returns The layout, equal to the one that was packed.
 */
export function unpackTextLayout(packed: PackedTextLayout): TextLayout {
  const glyphView = new DataView(packed.glyphs);
  const glyphs: LayoutGlyph[] = [];
  for (let field = 0; field < glyphView.byteLength / BYTES_PER_FIELD; field += GLYPH_FIELDS) {
    const read = (offset: number): number =>
      glyphView.getFloat64((field + offset) * BYTES_PER_FIELD, true);
    glyphs.push({
      codepoint: read(0),
      index: read(1),
      line: read(2),
      x: read(3),
      y: read(4),
      advance: read(5),
      run: read(6),
      end: read(7),
      glyphId: read(8) === NO_GLYPH_ID ? null : read(8),
      level: read(9),
    });
  }
  const lineView = new DataView(packed.lines);
  const lines: LayoutLine[] = [];
  for (let field = 0; field < lineView.byteLength / BYTES_PER_FIELD; field += LINE_FIELDS) {
    const read = (offset: number): number =>
      lineView.getFloat64((field + offset) * BYTES_PER_FIELD, true);
    lines.push({
      start: read(0),
      end: read(1),
      isHard: read(2) === 1,
      x: read(3),
      y: read(4),
      height: read(5),
      ascent: read(6),
      descent: read(7),
      baseline: read(8),
      width: read(9),
    });
  }
  const { text, runs, width, height, markers, decorations } = packed;
  return { text, runs, glyphs, lines, width, height, markers, decorations };
}

function writeFields(view: DataView, firstField: number, fields: readonly number[]): void {
  fields.forEach((value, offset) => {
    view.setFloat64((firstField + offset) * BYTES_PER_FIELD, value, true);
  });
}

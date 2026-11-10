import { readCharacterMap } from './character-map.js';
import { readDecorationMetrics, type DecorationMetrics } from './decoration-metrics.js';
import { FontFormatError } from './font-format-error.js';
import { GlyfTable } from './glyf-table.js';
import type { GlyphOutline } from './glyph-outline.js';
import { readHorizontalMetrics } from './horizontal-metrics.js';
import { kerningKey, readKerningPairs } from './kerning-table.js';
import { SfntFile } from './sfnt-file.js';

const BLANK_OUTLINE: GlyphOutline = { contours: [] };

/**
 * A font face read from its TrueType/OpenType bytes, DOM-free, so layout and the raster
 * fallback can run in a job worker or in Node tests without a canvas (the prototype measured
 * with Canvas2D: `src/text/measure.ts`). All lengths are in em units.
 */
export interface ParsedFont {
  /** Font units per em. */
  readonly unitsPerEm: number;
  /** Height above the baseline, in em. */
  readonly ascent: number;
  /** Depth below the baseline, in em, positive. */
  readonly descent: number;
  /** Where it draws underlines and strikethroughs; absent in a font that leaves them out. */
  readonly decoration?: DecorationMetrics;
  /**
   * The glyph that draws a character.
   *
   * @param codepoint - A Unicode codepoint.
   * @returns Its glyph id; 0 (`.notdef`) when the font does not map it.
   */
  glyphIdOf(codepoint: number): number;
  /**
   * A glyph's advance width.
   *
   * @param glyphId - The glyph.
   * @returns The advance, in em; 0 for an out-of-range id.
   */
  advanceOf(glyphId: number): number;
  /**
   * The kerning between two glyphs set side by side.
   *
   * @param leftGlyphId - The glyph on the left.
   * @param rightGlyphId - The glyph on the right.
   * @returns The adjustment to the left glyph's advance, in em (usually negative or 0).
   */
  kerningOf(leftGlyphId: number, rightGlyphId: number): number;
  /**
   * Every character the font maps.
   *
   * @returns `[codepoint, glyphId]` pairs, in ascending codepoint order.
   */
  characterMap(): readonly (readonly [number, number])[];
  /**
   * The kerned glyph pairs.
   *
   * @returns `[leftGlyphId, rightGlyphId, adjustmentEm]` triples.
   */
  kerningPairs(): readonly (readonly [number, number, number])[];
  /**
   * A glyph's outline, decoded on demand (TrueType outlines only).
   *
   * @param glyphId - The glyph.
   * @returns Its contours in em units, y up; none for a blank glyph or a CFF-flavoured font.
   * @throws {FontFormatError} When the glyph data is corrupt.
   */
  outlineOf(glyphId: number): GlyphOutline;
}

/**
 * Reads a TrueType/OpenType font face: its Unicode character map, horizontal metrics, `kern`
 * pairs and (lazily) its TrueType outlines. It keeps its own copy of the bytes, so the caller
 * may reuse or transfer them.
 *
 * @param bytes - The font file (`.ttf` or `.otf`; not a `.ttc` collection).
 * @returns The parsed face.
 * @throws {FontFormatError} When the file is truncated, a collection, of an unknown version, or
 *   lacks a required table (`cmap`, `head`, `hhea`, `maxp`, `hmtx`).
 */
export function parseFont(bytes: ArrayBuffer | ArrayBufferView): ParsedFont {
  return asFontFormatError(() => parseFontUnguarded(bytes));
}

/**
 * Runs a read of font bytes, reporting any failure as a FontFormatError: a read past
 * a table's end (a RangeError from a DataView) or any other fault means the bytes are corrupt, and
 * a caller only ever has one kind of error to catch for a bad face.
 *
 * @param read - The read.
 * @returns What it returns.
 * @throws {FontFormatError} When it throws anything.
 */
function asFontFormatError<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof FontFormatError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new FontFormatError(`The font's tables are corrupt (${reason}).`);
  }
}

/**
 * Reads a font face, as {@link parseFont} does, letting a read past a table's end throw as it is.
 *
 * @param bytes - The font file.
 * @returns The parsed face.
 */
function parseFontUnguarded(bytes: ArrayBuffer | ArrayBufferView): ParsedFont {
  const copy = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice().buffer
    : bytes.slice(0);
  const file = new SfntFile(copy);
  const metrics = readHorizontalMetrics(file);
  const characters = readCharacterMap(file);
  const kerning = readKerningPairs(file, metrics.unitsPerEm);
  const glyf = file.hasTable('glyf')
    ? new GlyfTable(file, metrics.indexToLocFormat, metrics.unitsPerEm, metrics.glyphCount)
    : undefined;
  const sortedCharacters = [...characters].sort(([left], [right]) => left - right);
  return {
    unitsPerEm: metrics.unitsPerEm,
    ascent: metrics.ascent,
    descent: metrics.descent,
    decoration: readDecorationMetrics(file, metrics.unitsPerEm),
    glyphIdOf: (codepoint) => characters.get(codepoint) ?? 0,
    advanceOf: (glyphId) => metrics.advances[glyphId] ?? 0,
    kerningOf: (left, right) => kerning.get(kerningKey(left, right)) ?? 0,
    characterMap: () => sortedCharacters,
    kerningPairs: () =>
      [...kerning].map(
        ([key, value]) => [Math.floor(key / 0x10000), key % 0x10000, value] as const,
      ),
    outlineOf: (glyphId) => asFontFormatError(() => glyf?.outline(glyphId) ?? BLANK_OUTLINE),
  };
}

// The shaper's public types: a face, the shaper, and a
// shaped run.

import type { GlyphOutline } from '../font/glyph-outline.js';

import type { ColourGlyphSource } from './colour-glyph.js';
import type { TextDirection } from './text-direction.js';

/** A face HarfBuzz shapes with. */
export interface ShapingFace {
  /** The id it was made with. */
  readonly id: string;
  /** The font's units per em: shaped values are divided by it. */
  readonly unitsPerEm: number;
  /** The coordinates it is drawn at, normalised; empty for the default instance. */
  readonly variations: Readonly<Record<string, number>>;
  /** Their `variationKey`: empty for the default instance and for every static face. */
  readonly variationKey: string;
}

/** HarfBuzz, loaded. */
export interface Shaper extends ColourGlyphSource {
  /** HarfBuzz's version, for example `14.5.0`. */
  readonly version: string;
  /** The summed size of the font files the shaper keeps, at most its budget plus the newest file. */
  readonly retainedFaceBytes: number;
  /**
   * A face to shape with, from a font file's bytes; the font is read once per id while the shaper
   * keeps it, so a later call with the same id uses the first call's bytes whatever bytes it
   * passes, until the file is dropped to keep the shaper within its byte budget; the next call
   * reads it again from its bytes, and a face handed out before still shapes. Coordinates are
   * normalised against the font's own axes (`normaliseVariations`): at the default instance, and
   * for every static font, the face is the id's one permanent face; at other coordinates it is
   * the same object as long as any caller holds it, and an equivalent one after. Only the
   * `MAX_VARIATION_INSTANCES` most recently used instances keep their fonts; another's is
   * made again on use.
   *
   * @param id - The face's id (the caller's face id).
   * @param bytes - The font file.
   * @param variations - The coordinates to draw at, by axis tag; the default when absent.
   * @returns The face.
   */
  face(id: string, bytes: Uint8Array, variations?: Readonly<Record<string, number>>): ShapingFace;
  /**
   * A glyph's outline as HarfBuzz draws it: TrueType, CFF and CFF2 outlines alike, in
   * em, y up, closed contours of lines, quadratics and cubics. A glyph the face does not have, a
   * face HarfBuzz cannot read, or an outline past `MAX_OUTLINE_SEGMENTS` segments gives an empty
   * outline; it never throws.
   *
   * @param face - A face of this shaper.
   * @param glyphId - The glyph's id in the font.
   * @returns The outline.
   * @throws {RangeError} When the face is not this shaper's.
   */
  outline(face: ShapingFace, glyphId: number): GlyphOutline;
}

/** One shaped glyph, in HarfBuzz's buffer order: visual order, so a right-to-left run reversed. */
export interface ShapedGlyph {
  /** The glyph's id in the font. */
  readonly glyphId: number;
  /** The UTF-16 index, in the whole text, of the first character of the glyph's cluster. */
  readonly cluster: number;
  /** The advance, in em. */
  readonly advance: number;
  /** The offset from the pen, in em, x to the right. */
  readonly xOffset: number;
  /** The offset from the pen, in em, y up (as fonts measure). */
  readonly yOffset: number;
  /** Whether HarfBuzz flagged the glyph unsafe to break before (`UNSAFE_TO_BREAK`). */
  readonly isUnsafeToBreak: boolean;
}

/** A shaped stretch of text. */
export interface ShapedRun {
  /** The direction it was shaped in. */
  readonly direction: TextDirection;
  /** Its glyphs, in visual order. */
  readonly glyphs: readonly ShapedGlyph[];
}

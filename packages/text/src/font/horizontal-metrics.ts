import type { FontFormatError } from './font-format-error.js';
import type { SfntFile } from './sfnt-file.js';

/** The font-wide numbers layout needs, from the `head`, `hhea`, `maxp` and `hmtx` tables. */
export interface HorizontalMetrics {
  /** Font units per em (`head.unitsPerEm`). */
  readonly unitsPerEm: number;
  /** `head.indexToLocFormat`: 0 for short `loca` offsets, 1 for long ones. */
  readonly indexToLocFormat: number;
  /** Glyphs in the font (`maxp.numGlyphs`). */
  readonly glyphCount: number;
  /** Height above the baseline, in em (`hhea.ascender`). */
  readonly ascent: number;
  /** Depth below the baseline, in em, positive (`-hhea.descender`). */
  readonly descent: number;
  /** Advance width of every glyph, in em, indexed by glyph id. */
  readonly advances: Float64Array;
}

/**
 * Reads the font's horizontal metrics. The advance of a glyph past `numberOfHMetrics` is the
 * last listed advance (monospaced tails share it), per the OpenType `hmtx` table.
 *
 * @param file - The font file.
 * @returns Units per em, vertical extents and every glyph's advance, in em.
 * @throws {FontFormatError} When `head`, `hhea`, `maxp` or `hmtx` is missing.
 */
export function readHorizontalMetrics(file: SfntFile): HorizontalMetrics {
  const head = file.table('head');
  const hhea = file.table('hhea');
  const maxp = file.table('maxp');
  const hmtx = file.table('hmtx');
  const unitsPerEm = head.getUint16(18);
  const glyphCount = maxp.getUint16(4);
  const listedCount = Math.min(hhea.getUint16(34), glyphCount);
  const advances = new Float64Array(glyphCount);
  let lastAdvance = 0;
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    if (glyphId < listedCount) lastAdvance = hmtx.getUint16(glyphId * 4) / unitsPerEm;
    advances[glyphId] = lastAdvance;
  }
  return {
    unitsPerEm,
    indexToLocFormat: head.getInt16(50),
    glyphCount,
    ascent: hhea.getInt16(4) / unitsPerEm,
    descent: -hhea.getInt16(6) / unitsPerEm,
    advances,
  };
}

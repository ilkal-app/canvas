import type { SfntFile } from './sfnt-file.js';

/** Coverage bits of a Microsoft `kern` subtable. */
const HORIZONTAL = 0x1;
const MINIMUM = 0x2;
const CROSS_STREAM = 0x4;
const OVERRIDE = 0x8;

/**
 * The key of a glyph pair in the map {@link readKerningPairs} returns.
 *
 * @param left - The left glyph id.
 * @param right - The right glyph id.
 * @returns A number unique to the ordered pair.
 */
export function kerningKey(left: number, right: number): number {
  return left * 0x10000 + right;
}

/**
 * Reads pair kerning from the legacy `kern` table (version 0, format 0 subtables). GPOS pair
 * adjustment is not read: fonts that kern only through GPOS lay out unkerned, and a font whose
 * GPOS kerning differs from its `kern` table lays out with the `kern` values. (msdfgen's
 * stb_truetype prefers GPOS; kerning does not change glyph bitmaps, and for the bundled faces
 * both tables give the same values, cross-checked in `parse-font.test.ts`.)
 *
 * @param file - The font file.
 * @param unitsPerEm - The font's units per em, to convert values to em.
 * @returns Adjustments in em keyed by {@link kerningKey}; empty when the font has no usable
 *   `kern` table.
 */
export function readKerningPairs(file: SfntFile, unitsPerEm: number): Map<number, number> {
  const pairs = new Map<number, number>();
  if (!file.hasTable('kern')) return pairs;
  // Sum in font units, which are integers, and convert once, so sums stay exact.
  const kern = file.table('kern');
  // Version 1 (Apple's 32-bit header) starts with 0x0001 0x0000 and is not read.
  if (kern.getUint16(0) !== 0) return pairs;
  const subtableCount = kern.getUint16(2);
  let offset = 4;
  for (let subtable = 0; subtable < subtableCount; subtable += 1) {
    const length = kern.getUint16(offset + 2);
    const coverage = kern.getUint16(offset + 4);
    const format = coverage >> 8;
    const isUsable =
      format === 0 && (coverage & HORIZONTAL) !== 0 && (coverage & (MINIMUM | CROSS_STREAM)) === 0;
    if (isUsable) readFormatZero(kern, offset + 6, (coverage & OVERRIDE) !== 0, pairs);
    // A format 0 subtable's 16-bit length wraps past 64 KiB; its pair count does not.
    offset += format === 0 ? 14 + kern.getUint16(offset + 6) * 6 : length;
  }
  for (const [key, units] of pairs) pairs.set(key, units / unitsPerEm);
  return pairs;
}

/**
 * Reads the pairs of a format 0 subtable.
 *
 * @param kern - The `kern` table.
 * @param offset - Where the subtable's pair header starts.
 * @param isOverride - Whether its values replace earlier subtables' rather than add to them.
 * @param into - Receives the adjustments in font units, keyed by {@link kerningKey}.
 */
function readFormatZero(
  kern: DataView,
  offset: number,
  isOverride: boolean,
  into: Map<number, number>,
): void {
  const pairCount = kern.getUint16(offset);
  for (let pair = 0; pair < pairCount; pair += 1) {
    const record = offset + 8 + pair * 6;
    const key = kerningKey(kern.getUint16(record), kern.getUint16(record + 2));
    const units = kern.getInt16(record + 4);
    into.set(key, isOverride ? units : (into.get(key) ?? 0) + units);
  }
}

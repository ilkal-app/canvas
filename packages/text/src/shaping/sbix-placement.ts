// Where an sbix bitmap glyph sits: the strike's pixels per em and the image's origin
// offset, read from the `sbix` table, for HarfBuzz builds that give such a glyph no extents. It
// follows HarfBuzz's own choice (hb-ot-color-sbix-table.hh) so the placement belongs to the PNG
// `getGlyphColorPng` returns: with no ppem set, the strike of the largest ppem, the glyph's record
// there, a `dupe` record followed to the glyph it names, and only a PNG.

/** Where a glyph's PNG in HarfBuzz's strike sits. */
export interface SbixPlacement {
  /** The strike's pixels per em. */
  readonly ppem: number;
  /** The image's left edge from the glyph origin, in the strike's pixels. */
  readonly originX: number;
  /** The image's bottom edge from the baseline, in the strike's pixels, y up. */
  readonly originY: number;
}

/** The sbix header: version, flags and the strike count. */
const HEADER_BYTES = 8;
/** A strike's header: ppem and ppi, before its glyph data offsets. */
const STRIKE_HEADER_BYTES = 4;
/** A glyph's data header: its origin offsets and its graphic type tag. */
const GLYPH_HEADER_BYTES = 8;
/** How many `dupe` records HarfBuzz follows before it gives up. */
const MAX_DUPES = 8;
/** The graphic type tags read, as big-endian 32-bit numbers. */
const PNG_TAG = 0x706e6720; // 'png '
const DUPE_TAG = 0x64757065; // 'dupe'

/**
 * A font's glyph count, from its `maxp` table.
 *
 * @param maxp - The `maxp` table's bytes.
 * @returns The count; 0 for a table too short to hold it.
 */
export function glyphCountOf(maxp: Uint8Array): number {
  if (maxp.length < 6) return 0;
  return new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength).getUint16(4);
}

/**
 * The strike HarfBuzz takes a PNG from when no ppem is set: the largest ppem, the first of equals.
 *
 * @param view - The `sbix` table.
 * @param glyphCount - The font's glyph count, sizing each strike's offset array.
 * @returns The strike's offset in the table, or undefined for none or a malformed table.
 */
function largestStrike(view: DataView, glyphCount: number): number | undefined {
  const strikes = view.getUint32(4);
  const arrayBytes = STRIKE_HEADER_BYTES + (glyphCount + 1) * 4;
  if (HEADER_BYTES + strikes * 4 > view.byteLength) return undefined;
  let best: number | undefined;
  let bestPpem = -1;
  for (let index = 0; index < strikes; index += 1) {
    const strike = view.getUint32(HEADER_BYTES + index * 4);
    if (strike < HEADER_BYTES || strike + arrayBytes > view.byteLength) return undefined;
    const ppem = view.getUint16(strike);
    if (ppem > bestPpem) {
      best = strike;
      bestPpem = ppem;
    }
  }
  return best;
}

/**
 * The placement of a glyph's PNG in the strike HarfBuzz reads with no ppem set. Pure; a missing
 * record, a record of another graphic type, or a malformed table gives undefined.
 *
 * @param sbix - The `sbix` table's bytes.
 * @param glyphId - The glyph's id.
 * @param glyphCount - The font's glyph count (`glyphCountOf` its `maxp`).
 * @returns The placement, or undefined when that strike has no PNG for the glyph.
 */
export function sbixPlacement(
  sbix: Uint8Array,
  glyphId: number,
  glyphCount: number,
): SbixPlacement | undefined {
  const isGlyph = (id: number): boolean => Number.isInteger(id) && id >= 0 && id < glyphCount;
  if (sbix.length < HEADER_BYTES || !isGlyph(glyphId)) return undefined;
  const view = new DataView(sbix.buffer, sbix.byteOffset, sbix.byteLength);
  const strike = largestStrike(view, glyphCount);
  if (strike === undefined) return undefined;
  const records = strike + STRIKE_HEADER_BYTES;
  const recordsEnd = records + (glyphCount + 1) * 4;
  let id = glyphId;
  for (let dupes = 0; dupes <= MAX_DUPES; dupes += 1) {
    const start = strike + view.getUint32(records + id * 4);
    const end = strike + view.getUint32(records + (id + 1) * 4);
    if (start < recordsEnd || end > sbix.length || end - start <= GLYPH_HEADER_BYTES) {
      return undefined;
    }
    const tag = view.getUint32(start + 4);
    if (tag === PNG_TAG) {
      return {
        ppem: view.getUint16(strike),
        originX: view.getInt16(start),
        originY: view.getInt16(start + 2),
      };
    }
    if (tag !== DUPE_TAG || end - start < GLYPH_HEADER_BYTES + 2) return undefined;
    id = view.getUint16(start + GLYPH_HEADER_BYTES);
    if (!isGlyph(id)) return undefined;
  }
  return undefined;
}

import type { SfntTable } from './sfnt-tables.js';

/**
 * Reads one name from a font's `name` table: Windows Unicode English first, then any Windows
 * Unicode record, then a Macintosh Roman one.
 *
 * @param view - The font's bytes.
 * @param table - Its `name` table, or undefined for none.
 * @param nameId - The name id.
 * @returns The name, or undefined when the table has no readable record for it.
 */
export function fontName(
  view: DataView,
  table: SfntTable | undefined,
  nameId: number,
): string | undefined {
  if (table === undefined || table.length < 6) return undefined;
  const { offset, length } = table;
  const count = view.getUint16(offset + 2);
  const storageOffset = view.getUint16(offset + 4);
  const storage = offset + storageOffset;
  // The strings follow the records: storage inside them would read records as text.
  if (6 + count * 12 > length || storageOffset < 6 + count * 12) return undefined;
  let best: { readonly rank: number; readonly start: number; readonly size: number } | undefined;
  for (let index = 0; index < count; index += 1) {
    const record = offset + 6 + index * 12;
    if (view.getUint16(record + 6) !== nameId) continue;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const language = view.getUint16(record + 4);
    const rank =
      platform === 3 && (encoding === 1 || encoding === 10)
        ? language === 0x409
          ? 0
          : 1
        : platform === 1 && encoding === 0
          ? 2
          : 3;
    if (rank === 3 || (best !== undefined && best.rank <= rank)) continue;
    const start = storage + view.getUint16(record + 10);
    const size = view.getUint16(record + 8);
    if (start + size > offset + length) continue;
    best = { rank, start, size };
  }
  if (best === undefined) return undefined;
  const { rank, start, size } = best;
  if (rank === 2) {
    return Array.from({ length: size }, (unused, index) =>
      macRoman(view.getUint8(start + index)),
    ).join('');
  }
  const units = Array.from({ length: size >> 1 }, (unused, index) =>
    view.getUint16(start + index * 2),
  );
  return String.fromCharCode(...units);
}

/** Mac OS Roman's upper half, 0x80 to 0xFF, as Unicode characters (the lower half is ASCII). */
const MAC_ROMAN_HIGH =
  'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø' +
  '¿¡¬√ƒ≈∆«»…\u00a0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\uf8ffÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

/**
 * One Mac OS Roman byte as a character.
 *
 * @param byte - The byte.
 * @returns Its character.
 */
function macRoman(byte: number): string {
  return byte < 0x80 ? String.fromCharCode(byte) : (MAC_ROMAN_HIGH[byte - 0x80] ?? '\ufffd');
}

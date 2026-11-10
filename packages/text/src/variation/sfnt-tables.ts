/** One table of an sfnt font: where it starts and how long it is, inside the font's bytes. */
export interface SfntTable {
  /** Its byte offset in the font. */
  readonly offset: number;
  /** Its length in bytes. */
  readonly length: number;
}

const SFNT_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f]);

/**
 * Finds a table in an sfnt font (TrueType or OpenType, not a collection or a web font), within
 * the font's bytes.
 *
 * @param view - The font's bytes.
 * @param tag - The table's tag.
 * @returns The table, or undefined when the font has none or its directory is damaged.
 */
export function sfntTable(view: DataView, tag: string): SfntTable | undefined {
  if (view.byteLength < 12 || !SFNT_VERSIONS.has(view.getUint32(0))) return undefined;
  const count = view.getUint16(4);
  if (12 + count * 16 > view.byteLength) return undefined;
  for (let index = 0; index < count; index += 1) {
    const entry = 12 + index * 16;
    const entryTag = String.fromCharCode(
      view.getUint8(entry),
      view.getUint8(entry + 1),
      view.getUint8(entry + 2),
      view.getUint8(entry + 3),
    );
    if (entryTag !== tag) continue;
    const offset = view.getUint32(entry + 8);
    const length = view.getUint32(entry + 12);
    return offset + length <= view.byteLength ? { offset, length } : undefined;
  }
  return undefined;
}

import { describe, expect, it } from 'vitest';

import { sfntTable } from './sfnt-tables.js';

/**
 * A synthetic sfnt header with one table directory entry.
 *
 * @param version - The sfnt version.
 * @param entry - The entry's tag, offset and length.
 * @param entry.tag - The table tag.
 * @param entry.offset - Its offset.
 * @param entry.length - Its length.
 * @param size - The font's whole length.
 * @returns The bytes.
 */
function font(
  version: number,
  entry: { tag: string; offset: number; length: number },
  size = 64,
): DataView {
  const view = new DataView(new ArrayBuffer(size));
  view.setUint32(0, version);
  view.setUint16(4, 1);
  for (let index = 0; index < 4; index += 1) view.setUint8(12 + index, entry.tag.charCodeAt(index));
  view.setUint32(20, entry.offset);
  view.setUint32(24, entry.length);
  return view;
}

describe('sfntTable', () => {
  it('finds a table in TrueType, "true" and OpenType-CFF fonts', () => {
    for (const version of [0x00010000, 0x74727565, 0x4f54544f]) {
      expect(sfntTable(font(version, { tag: 'fvar', offset: 28, length: 16 }), 'fvar')).toEqual({
        offset: 28,
        length: 16,
      });
    }
  });

  it('finds nothing in another format, a short font, a missing table or one past the end', () => {
    const entry = { tag: 'fvar', offset: 28, length: 16 };
    expect(sfntTable(font(0x774f4646, entry), 'fvar')).toBeUndefined();
    expect(sfntTable(new DataView(new ArrayBuffer(8)), 'fvar')).toBeUndefined();
    expect(sfntTable(font(0x00010000, entry), 'name')).toBeUndefined();
    expect(sfntTable(font(0x00010000, { ...entry, length: 64 }), 'fvar')).toBeUndefined();
    const truncated = font(0x00010000, entry);
    truncated.setUint16(4, 40);
    expect(sfntTable(truncated, 'fvar')).toBeUndefined();
  });
});

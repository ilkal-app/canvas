import { describe, expect, it } from 'vitest';

import { fontName } from './font-names.js';

/** One record of a synthetic name table. */
interface NameRecord {
  readonly platform: number;
  readonly encoding: number;
  readonly language: number;
  readonly nameId: number;
  readonly bytes: readonly number[];
}

/**
 * A synthetic `name` table, format 0, its strings stored in order after the records.
 *
 * @param records - Its records.
 * @param lengthCut - Bytes to leave off the table's declared length.
 * @returns The bytes, and the table as `fontName` takes it.
 */
function nameTable(records: readonly NameRecord[], lengthCut = 0) {
  const header = 6 + records.length * 12;
  const storage = records.reduce((size, record) => size + record.bytes.length, 0);
  const view = new DataView(new ArrayBuffer(header + storage));
  view.setUint16(2, records.length);
  view.setUint16(4, header);
  let at = 0;
  records.forEach((record, index) => {
    const entry = 6 + index * 12;
    view.setUint16(entry, record.platform);
    view.setUint16(entry + 2, record.encoding);
    view.setUint16(entry + 4, record.language);
    view.setUint16(entry + 6, record.nameId);
    view.setUint16(entry + 8, record.bytes.length);
    view.setUint16(entry + 10, at);
    record.bytes.forEach((byte, offset) => {
      view.setUint8(header + at + offset, byte);
    });
    at += record.bytes.length;
  });
  return { view, table: { offset: 0, length: view.byteLength - lengthCut } };
}

const codes = (text: string): number[] =>
  Array.from({ length: text.length }, (unused, index) => text.charCodeAt(index));
const utf16 = (text: string): number[] => codes(text).flatMap((code) => [code >> 8, code & 0xff]);
const ascii = codes;

describe('fontName', () => {
  it('prefers Windows Unicode English, then other Windows Unicode, then Macintosh Roman', () => {
    const { view, table } = nameTable([
      { platform: 1, encoding: 0, language: 0, nameId: 256, bytes: ascii('Mac') },
      { platform: 3, encoding: 1, language: 0x407, nameId: 256, bytes: utf16('Breite') },
      { platform: 3, encoding: 1, language: 0x409, nameId: 256, bytes: utf16('Width') },
      { platform: 3, encoding: 10, language: 0x407, nameId: 257, bytes: utf16('Gewicht') },
      { platform: 1, encoding: 0, language: 0, nameId: 257, bytes: ascii('Weight') },
      { platform: 1, encoding: 0, language: 0, nameId: 258, bytes: ascii('Slant') },
      { platform: 0, encoding: 3, language: 0, nameId: 259, bytes: utf16('Unicode only') },
    ]);
    expect(fontName(view, table, 256)).toBe('Width');
    expect(fontName(view, table, 257)).toBe('Gewicht');
    expect(fontName(view, table, 258)).toBe('Slant');
    expect(fontName(view, table, 259)).toBeUndefined();
    expect(fontName(view, table, 300)).toBeUndefined();
  });

  it('decodes Macintosh Roman beyond ASCII', () => {
    const { view, table } = nameTable([
      { platform: 1, encoding: 0, language: 0, nameId: 256, bytes: [0x43, 0x8e, 0x74, 0xa5, 0xff] },
    ]);
    expect(fontName(view, table, 256)).toBe('Cét•ˇ');
  });

  it('refuses a string storage that starts inside the records', () => {
    const record = { platform: 3, encoding: 1, language: 0x409, nameId: 256 };
    const { view, table } = nameTable([{ ...record, bytes: utf16('Weight') }]);
    view.setUint16(4, 8);
    expect(fontName(view, table, 256)).toBeUndefined();
  });

  it('reads nothing past the table: no table, a short header, records or a string outside it', () => {
    const record = { platform: 3, encoding: 1, language: 0x409, nameId: 256 };
    const { view, table } = nameTable([{ ...record, bytes: utf16('Weight') }]);
    expect(fontName(view, undefined, 256)).toBeUndefined();
    expect(fontName(view, { offset: 0, length: 4 }, 256)).toBeUndefined();
    expect(fontName(view, { offset: 0, length: 10 }, 256)).toBeUndefined();
    const cut = nameTable([{ ...record, bytes: utf16('Weight') }], 2);
    expect(fontName(cut.view, cut.table, 256)).toBeUndefined();
    expect(fontName(view, table, 256)).toBe('Weight');
  });
});

import { describe, expect, it } from 'vitest';

import { collectionFaceCount, extractFace, postScriptNamesOf } from './font-collection.js';
import { FontFormatError } from './font-format-error.js';

/** One table of a synthetic face: its tag and bytes. */
interface SyntheticTable {
  readonly tag: string;
  readonly bytes: Uint8Array;
}

/**
 * A big-endian 32-bit tag from four characters.
 *
 * @param tag - The characters.
 * @returns The tag.
 */
function tagValue(tag: string): number {
  let value = 0;
  for (let index = 0; index < 4; index += 1) value = value * 256 + tag.charCodeAt(index);
  return value;
}

/**
 * A collection of synthetic faces: the `ttcf` header, then each face's offset table and
 * directory, then every table's bytes.
 *
 * @param faces - Each face's sfnt version and tables.
 * @returns The collection's bytes.
 */
function collectionOf(
  faces: readonly { version: number; tables: readonly SyntheticTable[] }[],
): Uint8Array {
  const header = 12 + faces.length * 4;
  const directories = faces.map(({ tables }) => 12 + tables.length * 16);
  let size = header + directories.reduce((sum, bytes) => sum + bytes, 0);
  const tableOffsets = faces.map(({ tables }) =>
    tables.map(({ bytes }) => {
      const offset = size;
      size += Math.ceil(bytes.length / 4) * 4;
      return offset;
    }),
  );
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, tagValue('ttcf'));
  view.setUint32(4, 0x00010000);
  view.setUint32(8, faces.length);
  let at = header;
  faces.forEach(({ version, tables }, face) => {
    view.setUint32(12 + face * 4, at);
    view.setUint32(at, version);
    view.setUint16(at + 4, tables.length);
    tables.forEach(({ tag, bytes }, index) => {
      const record = at + 12 + index * 16;
      const offset = tableOffsets[face]?.[index] ?? 0;
      view.setUint32(record, tagValue(tag));
      view.setUint32(record + 8, offset);
      view.setUint32(record + 12, bytes.length);
      out.set(bytes, offset);
    });
    at += directories[face] ?? 0;
  });
  return out;
}

/**
 * A `name` table with one name ID 6 record.
 *
 * @param platform - The record's platform.
 * @param encoding - Its encoding.
 * @param text - The name, as bytes in that encoding.
 * @param size - The length the record claims (its text's length by default).
 * @returns The table.
 */
function nameTable(platform: number, encoding: number, text: Uint8Array, size = text.length) {
  const bytes = new Uint8Array(6 + 12 + text.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1);
  view.setUint16(4, 18);
  view.setUint16(6, platform);
  view.setUint16(8, encoding);
  view.setUint16(12, 6);
  view.setUint16(14, size);
  view.setUint16(16, 0);
  bytes.set(text, 18);
  return { tag: 'name', bytes };
}

const TRUETYPE = 0x00010000;

/**
 * Points a table record of a collection's first face at other bytes, in place.
 *
 * @param collection - A collection from {@link collectionOf}, with one face first.
 * @param faces - How many faces it holds.
 * @param index - The record.
 * @param offset - Where its bytes now start.
 * @param length - How many there are.
 */
function pointRecord(
  collection: Uint8Array,
  faces: number,
  index: number,
  offset: number,
  length: number,
): void {
  const record = 12 + faces * 4 + 12 + index * 16;
  const view = new DataView(collection.buffer);
  view.setUint32(record + 8, offset);
  view.setUint32(record + 12, length);
}

describe('font collections', () => {
  it('refuses a file too short to hold a signature', () => {
    expect(() => collectionFaceCount(new Uint8Array(3))).toThrow(FontFormatError);
  });

  it('refuses to extract a face whose version is unknown or whose directory is cut off', () => {
    const unknown = collectionOf([{ version: 0x12345678, tables: [] }]);
    expect(collectionFaceCount(unknown)).toBe(1);
    expect(() => extractFace(unknown, 0)).toThrow(/Unknown sfnt version/);
    const cut = collectionOf([{ version: TRUETYPE, tables: [] }]);
    new DataView(cut.buffer).setUint16(16 + 4, 40);
    expect(() => extractFace(cut, 0)).toThrow(/table directory runs past/);
  });

  it('extracts a face without tables as a bare offset table', () => {
    const empty = extractFace(collectionOf([{ version: TRUETYPE, tables: [] }]), 0);
    expect([...empty]).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('copies bytes named by many records once', () => {
    const tables = Array.from({ length: 200 }, () => ({ tag: 'aaaa', bytes: new Uint8Array(4) }));
    const collection = collectionOf([{ version: TRUETYPE, tables }]);
    const first = 12 + 4 + 12 + 200 * 16;
    for (let index = 0; index < 200; index += 1) pointRecord(collection, 1, index, first, 4);
    const face = extractFace(collection, 0);
    const view = new DataView(face.buffer);
    expect(face.length).toBe(12 + 200 * 16 + 4);
    expect(new Set(tables.map((unused, index) => view.getUint32(12 + index * 16 + 8)))).toEqual(
      new Set([12 + 200 * 16]),
    );
  });

  it('refuses a face whose overlapping tables would be larger than its file', () => {
    const tables = Array.from({ length: 200 }, () => ({
      tag: 'aaaa',
      bytes: new Uint8Array(400),
    }));
    const collection = collectionOf([{ version: TRUETYPE, tables }]);
    const first = 12 + 4 + 12 + 200 * 16;
    for (let index = 0; index < 200; index += 1) {
      pointRecord(collection, 1, index, first + index, 40_000);
    }
    expect(() => extractFace(collection, 0)).toThrow(FontFormatError);
  });

  it('reads no name from a name table whose records or strings are out of place', () => {
    const latin1 = new TextEncoder().encode('MacName');
    const pastTable = nameTable(1, 0, latin1);
    new DataView(pastTable.bytes.buffer).setUint16(2, 5);
    const intoRecords = nameTable(1, 0, latin1);
    new DataView(intoRecords.bytes.buffer).setUint16(4, 6);
    const pastEnd = nameTable(1, 0, latin1);
    new DataView(pastEnd.bytes.buffer).setUint16(4, 400);
    const names = postScriptNamesOf(
      collectionOf([
        { version: TRUETYPE, tables: [pastTable] },
        { version: TRUETYPE, tables: [intoRecords] },
        { version: TRUETYPE, tables: [pastEnd] },
        { version: 0x12345678, tables: [nameTable(1, 0, latin1)] },
      ]),
    );
    expect(names).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('names a face from its Macintosh record, and none without a usable record', () => {
    const latin1 = new TextEncoder().encode('MacName');
    const utf16 = new Uint8Array([0, 65, 0, 66]);
    const names = postScriptNamesOf(
      collectionOf([
        { version: TRUETYPE, tables: [nameTable(1, 0, latin1)] },
        { version: TRUETYPE, tables: [] },
        { version: TRUETYPE, tables: [nameTable(3, 1, utf16, 400)] },
        { version: TRUETYPE, tables: [nameTable(0, 3, utf16)] },
        { version: TRUETYPE, tables: [{ tag: 'name', bytes: new Uint8Array(2) }] },
      ]),
    );
    expect(names).toEqual(['MacName', undefined, undefined, undefined, undefined]);
  });
});

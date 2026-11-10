// Font collections: a TTC or OTC file holds several faces sharing tables. A face is
// extracted into a standalone sfnt when a font loads, so every consumer downstream (the parser,
// HarfBuzz, the engine's jobs) reads an ordinary font file and needs no face index.

import { FontFormatError } from './font-format-error.js';

/** A collection's tag, `ttcf`. */
const COLLECTION_TAG = 0x74746366;
/** A plain sfnt's versions: TrueType (`0x00010000`, `true`) and CFF (`OTTO`) outlines. */
const SFNT_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f]);
/** The bytes of an sfnt's offset table and of one table record. */
const OFFSET_TABLE_BYTES = 12;
const TABLE_RECORD_BYTES = 16;
/** The most bytes an sfnt can hold: its table offsets are 32-bit. */
const SFNT_MAX_BYTES = 2 ** 32;
/** The bytes of a collection's header before its offsets (tag, version, count). */
const COLLECTION_HEADER_BYTES = 12;

/** One table of a face: its record's fields and where its bytes are in the file. */
interface FaceTable {
  readonly tag: number;
  readonly checksum: number;
  readonly offset: number;
  readonly length: number;
}

/**
 * The bytes as one view, whatever they came as.
 *
 * @param bytes - A font file.
 * @returns A view of exactly its bytes.
 */
function viewOf(bytes: ArrayBufferLike | ArrayBufferView): DataView {
  return ArrayBuffer.isView(bytes)
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new DataView(bytes);
}

/**
 * Where each face's offset table starts: one at 0 for a plain sfnt, the header's offsets for a
 * collection.
 *
 * @param view - The font file.
 * @returns The offsets, in face order.
 * @throws {FontFormatError} When the file is neither a collection nor a plain sfnt, or its
 *   header is truncated, empty or points past the end.
 */
function faceOffsetsOf(view: DataView): number[] {
  if (view.byteLength < 4) throw new FontFormatError('The font file is too short.');
  const tag = view.getUint32(0);
  if (SFNT_VERSIONS.has(tag)) {
    if (view.byteLength < OFFSET_TABLE_BYTES) {
      throw new FontFormatError('The font file is too short to hold a table directory.');
    }
    return [0];
  }
  if (tag !== COLLECTION_TAG) {
    throw new FontFormatError(`Unknown font file signature 0x${tag.toString(16)}.`);
  }
  if (view.byteLength < COLLECTION_HEADER_BYTES) {
    throw new FontFormatError('The collection header is truncated.');
  }
  const count = view.getUint32(8);
  if (count === 0) throw new FontFormatError('The collection holds no faces.');
  if (COLLECTION_HEADER_BYTES + count * 4 > view.byteLength) {
    throw new FontFormatError('The collection header runs past the end of the file.');
  }
  return Array.from({ length: count }, (unused, index) => {
    const offset = view.getUint32(COLLECTION_HEADER_BYTES + index * 4);
    if (offset + OFFSET_TABLE_BYTES > view.byteLength) {
      throw new FontFormatError(
        `Face ${String(index)}'s offset table is past the end of the file.`,
      );
    }
    return offset;
  });
}

/**
 * A face's tables, from its offset table.
 *
 * @param view - The font file.
 * @param at - Where the face's offset table starts.
 * @returns The sfnt version and the tables, in directory order.
 * @throws {FontFormatError} When the directory or a table runs past the end of the file.
 */
function faceTablesAt(view: DataView, at: number): { version: number; tables: FaceTable[] } {
  const version = view.getUint32(at);
  if (!SFNT_VERSIONS.has(version)) {
    throw new FontFormatError(`Unknown sfnt version 0x${version.toString(16)}.`);
  }
  const count = view.getUint16(at + 4);
  if (at + OFFSET_TABLE_BYTES + count * TABLE_RECORD_BYTES > view.byteLength) {
    throw new FontFormatError('The table directory runs past the end of the file.');
  }
  const tables = Array.from({ length: count }, (unused, index): FaceTable => {
    const record = at + OFFSET_TABLE_BYTES + index * TABLE_RECORD_BYTES;
    const table = {
      tag: view.getUint32(record),
      checksum: view.getUint32(record + 4),
      offset: view.getUint32(record + 8),
      length: view.getUint32(record + 12),
    };
    if (table.offset + table.length > view.byteLength) {
      throw new FontFormatError('A table runs past the end of the file.');
    }
    return table;
  });
  return { version, tables };
}

/**
 * How many faces a font file holds: the count of a `ttcf` collection (TTC or OTC), or
 * 1 for a plain sfnt (TrueType or CFF outlines).
 *
 * @param bytes - The font file.
 * @returns The count, at least 1.
 * @throws {FontFormatError} When the file is neither, or its collection header is truncated,
 *   empty or points past the end.
 */
export function collectionFaceCount(bytes: ArrayBufferLike | ArrayBufferView): number {
  return faceOffsetsOf(viewOf(bytes)).length;
}

/**
 * One face of a font file as a standalone sfnt: for a collection, the face's offset
 * table (its binary-search fields recomputed), its table directory with offsets into the new file,
 * and a copy of each of its tables, each starting on a 4-byte boundary; tags, checksums and
 * lengths are kept, and records naming the same bytes share one copy. A plain sfnt is its only
 * face, copied. The input is never changed.
 *
 * @param bytes - The font file.
 * @param faceIndex - The face, from 0.
 * @returns The face's file.
 * @throws {FontFormatError} When the index is not a face of the file, the file is malformed, or
 *   the face's overlapping tables would make it larger than the file.
 */
export function extractFace(
  bytes: ArrayBufferLike | ArrayBufferView,
  faceIndex: number,
): Uint8Array {
  const view = viewOf(bytes);
  const offsets = faceOffsetsOf(view);
  const at = Number.isInteger(faceIndex) ? offsets[faceIndex] : undefined;
  if (at === undefined) {
    throw new FontFormatError(
      `Face ${String(faceIndex)} is not in the file, which holds ${String(offsets.length)}.`,
    );
  }
  const source = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (offsets.length === 1 && view.getUint32(0) !== COLLECTION_TAG) return source.slice();
  const { version, tables } = faceTablesAt(view, at);
  const directoryBytes = OFFSET_TABLE_BYTES + tables.length * TABLE_RECORD_BYTES;
  let size = directoryBytes;
  // Records naming the same bytes share one copy, so the face is never larger than its file.
  const copies = new Map<string, number>();
  const placed = tables.map((table) => {
    const range = `${String(table.offset)}:${String(table.length)}`;
    let offset = copies.get(range);
    if (offset === undefined) {
      offset = size;
      copies.set(range, offset);
      size += Math.ceil(table.length / 4) * 4;
    }
    return { ...table, newOffset: offset };
  });
  // Overlapping ranges could still multiply the bytes; a real face fits in its file's bytes. Every
  // table starts below `size`, so capping it at 2³² keeps each offset a 32-bit value.
  if (size > Math.min(SFNT_MAX_BYTES, directoryBytes + view.byteLength + tables.length * 3)) {
    throw new FontFormatError(
      'The face is larger than its file or than 4 GiB, so its tables overlap.',
    );
  }
  const out = new Uint8Array(size);
  const writer = new DataView(out.buffer);
  // The binary-search fields of the OpenType offset table.
  const entrySelector = tables.length === 0 ? 0 : Math.floor(Math.log2(tables.length));
  const searchRange = tables.length === 0 ? 0 : 2 ** entrySelector * 16;
  writer.setUint32(0, version);
  writer.setUint16(4, tables.length);
  writer.setUint16(6, searchRange);
  writer.setUint16(8, entrySelector);
  writer.setUint16(10, tables.length * 16 - searchRange);
  placed.forEach((table, index) => {
    const record = OFFSET_TABLE_BYTES + index * TABLE_RECORD_BYTES;
    writer.setUint32(record, table.tag);
    writer.setUint32(record + 4, table.checksum);
    writer.setUint32(record + 8, table.newOffset);
    writer.setUint32(record + 12, table.length);
    out.set(source.subarray(table.offset, table.offset + table.length), table.newOffset);
  });
  // The head table's checkSumAdjustment covers the whole file, so the new file needs its own.
  const head = placed.find((table) => table.tag === HEAD_TAG);
  if (head !== undefined && head.length >= 12) {
    writer.setUint32(head.newOffset + 8, 0);
    writer.setUint32(head.newOffset + 8, (CHECKSUM_MAGIC - checksumOf(writer)) >>> 0);
  }
  return out;
}

/** The `head` table's tag, and the constant its checkSumAdjustment is taken from. */
const HEAD_TAG = 0x68656164;
const CHECKSUM_MAGIC = 0xb1b0afba;

/**
 * The OpenType checksum of a whole file: its bytes as big-endian 32-bit words, summed modulo 2³².
 *
 * @param view - The file; its length is a multiple of 4.
 * @returns The checksum.
 */
function checksumOf(view: DataView): number {
  let sum = 0;
  for (let offset = 0; offset + 4 <= view.byteLength; offset += 4) {
    sum = (sum + view.getUint32(offset)) >>> 0;
  }
  return sum;
}

/** The `name` table's PostScript name record. */
const POSTSCRIPT_NAME_ID = 6;
/** The bytes of a `name` table's header (version, count, string offset) and of one record. */
const NAME_HEADER_BYTES = 6;
const NAME_RECORD_BYTES = 12;

/**
 * Each face's PostScript name: its `name` table's name ID 6, from a Windows Unicode
 * record (platform 3, encoding 1, UTF-16BE) when there is one, else a Macintosh Roman record
 * (platform 1, encoding 0, read as Latin-1). A local font is matched to its face this way.
 *
 * @param bytes - The font file.
 * @returns One name per face, in face order; `undefined` for a face without one.
 * @throws {FontFormatError} Where {@link collectionFaceCount} would.
 */
export function postScriptNamesOf(
  bytes: ArrayBufferLike | ArrayBufferView,
): (string | undefined)[] {
  const view = viewOf(bytes);
  return faceOffsetsOf(view).map((at) => {
    try {
      const name = faceTablesAt(view, at).tables.find((table) => table.tag === 0x6e616d65);
      return name === undefined ? undefined : postScriptNameIn(view, name.offset, name.length);
    } catch {
      // A face whose directory or name table cannot be read has no name to match.
      return undefined;
    }
  });
}

/**
 * The PostScript name in a `name` table.
 *
 * @param view - The font file.
 * @param at - Where the table starts.
 * @param length - Its length.
 * @returns The name, or `undefined` when the table has no usable record.
 */
function postScriptNameIn(view: DataView, at: number, length: number): string | undefined {
  if (length < NAME_HEADER_BYTES) return undefined;
  const table = new DataView(view.buffer, view.byteOffset + at, length);
  const count = table.getUint16(2);
  const strings = table.getUint16(4);
  // The records must fit, and the strings start after them, so no name is read from metadata.
  const recordsEnd = NAME_HEADER_BYTES + count * NAME_RECORD_BYTES;
  if (recordsEnd > length || strings < recordsEnd || strings > length) return undefined;
  let mac: string | undefined;
  for (let index = 0; index < count; index += 1) {
    const record = NAME_HEADER_BYTES + index * NAME_RECORD_BYTES;
    const platform = table.getUint16(record);
    const encoding = table.getUint16(record + 2);
    const nameId = table.getUint16(record + 6);
    if (nameId !== POSTSCRIPT_NAME_ID) continue;
    const size = table.getUint16(record + 8);
    const offset = strings + table.getUint16(record + 10);
    if (offset + size > length) continue;
    if (platform === 3 && encoding === 1) {
      let text = '';
      for (let char = 0; char + 1 < size; char += 2) {
        text += String.fromCharCode(table.getUint16(offset + char));
      }
      return text;
    }
    if (platform === 1 && encoding === 0 && mac === undefined) {
      let text = '';
      for (let char = 0; char < size; char += 1) {
        text += String.fromCharCode(table.getUint8(offset + char));
      }
      mac = text;
    }
  }
  return mac;
}

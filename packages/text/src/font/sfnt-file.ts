import { FontFormatError } from './font-format-error.js';

/** Where one table sits in an sfnt file. */
interface TableRecord {
  readonly offset: number;
  readonly length: number;
}

/** TrueType outlines (`0x00010000` or `'true'`) and CFF outlines (`'OTTO'`). */
const SUPPORTED_VERSIONS = new Set([0x00010000, 0x74727565, 0x4f54544f]);
const COLLECTION_TAG = 0x74746366;
const TABLE_DIRECTORY_BYTES = 12;
const TABLE_RECORD_BYTES = 16;

function tagOf(view: DataView, offset: number): string {
  let tag = '';
  for (let index = 0; index < 4; index += 1)
    tag += String.fromCharCode(view.getUint8(offset + index));
  return tag;
}

/**
 * An OpenType/TrueType file's table directory over the file's bytes (the "sfnt" wrapper every
 * `.ttf` and `.otf` shares). Tables are read through bounds-checked views, so a truncated or
 * corrupt file fails with a {@link FontFormatError} instead of reading garbage.
 */
export class SfntFile {
  private readonly tables = new Map<string, TableRecord>();

  /**
   * Reads the table directory.
   *
   * @param bytes - The whole font file; the caller must not change it afterwards.
   * @throws {FontFormatError} When the file is a collection, has an unknown version, or a table
   *   record points outside the file.
   */
  constructor(private readonly bytes: ArrayBuffer) {
    if (bytes.byteLength < TABLE_DIRECTORY_BYTES) {
      throw new FontFormatError('The font file is too short to hold a table directory.');
    }
    const view = new DataView(bytes);
    const version = view.getUint32(0);
    if (version === COLLECTION_TAG) {
      throw new FontFormatError('Font collections (.ttc) are not supported; pass one face.');
    }
    if (!SUPPORTED_VERSIONS.has(version)) {
      throw new FontFormatError(`Unknown sfnt version 0x${version.toString(16)}.`);
    }
    const tableCount = view.getUint16(4);
    if (TABLE_DIRECTORY_BYTES + tableCount * TABLE_RECORD_BYTES > bytes.byteLength) {
      throw new FontFormatError('The table directory runs past the end of the file.');
    }
    for (let index = 0; index < tableCount; index += 1) {
      const record = TABLE_DIRECTORY_BYTES + index * TABLE_RECORD_BYTES;
      const tag = tagOf(view, record);
      const offset = view.getUint32(record + 8);
      const length = view.getUint32(record + 12);
      if (offset + length > bytes.byteLength) {
        throw new FontFormatError(`The '${tag}' table runs past the end of the file.`);
      }
      this.tables.set(tag, { offset, length });
    }
  }

  /**
   * Whether the file has a table.
   *
   * @param tag - The four-character table tag, such as `glyf`.
   * @returns `true` when the table is present.
   */
  hasTable(tag: string): boolean {
    return this.tables.has(tag);
  }

  /**
   * A view of one table; reads past its end throw a `RangeError`.
   *
   * @param tag - The four-character table tag, such as `hmtx`.
   * @returns A view spanning exactly the table.
   * @throws {FontFormatError} When the table is missing.
   */
  table(tag: string): DataView {
    const record = this.tables.get(tag);
    if (record === undefined) throw new FontFormatError(`The font has no '${tag}' table.`);
    return new DataView(this.bytes, record.offset, record.length);
  }
}

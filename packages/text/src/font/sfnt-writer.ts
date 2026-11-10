// Lays tables out as an sfnt, for the web-font decoders.

import { FontFormatError } from './font-format-error.js';
import { checkSize, tagValue, viewOf } from './web-font-bytes.js';

/** The `head` table's tag. */
const HEAD = tagValue('head');

/** The tag and bytes of one table of a font being assembled. */
export interface SfntTable {
  readonly tag: number;
  readonly bytes: Uint8Array;
  /** The checksum to record, or `undefined` to compute it from the bytes. */
  readonly checksum?: number;
}

/**
 * The OpenType checksum of bytes: big-endian 32-bit words, the last zero-padded, summed modulo 2³².
 *
 * @param bytes - The bytes.
 * @returns The checksum.
 */
function checksumOf(bytes: Uint8Array): number {
  let sum = 0;
  const view = viewOf(bytes);
  const whole = bytes.length - (bytes.length % 4);
  for (let offset = 0; offset < whole; offset += 4) sum = (sum + view.getUint32(offset)) >>> 0;
  if (whole < bytes.length) {
    let last = 0;
    for (let offset = whole; offset < whole + 4; offset += 1)
      last = last * 256 + (bytes[offset] ?? 0);
    sum = (sum + last) >>> 0;
  }
  return sum;
}

/**
 * Lays tables out as an sfnt: the offset table with its search fields, the directory sorted by
 * tag, and each table on a 4-byte boundary, zero-padded.
 *
 * @param flavor - The sfnt version.
 * @param tables - The tables.
 * @param isRebuilt - Whether the tables were rebuilt, so checksums and `head`'s whole-file
 *   adjustment are computed anew (a WOFF2); otherwise the recorded ones are kept (a WOFF).
 * @returns The file.
 * @throws {FontFormatError} When a tag repeats or the file would pass the size limit.
 */
export function writeSfnt(
  flavor: number,
  tables: readonly SfntTable[],
  isRebuilt: boolean,
): Uint8Array {
  const sorted = [...tables].sort((left, right) => left.tag - right.tag);
  if (sorted.some((table, index) => index > 0 && sorted[index - 1]?.tag === table.tag)) {
    throw new FontFormatError('A table appears twice.');
  }
  const directory = 12 + 16 * sorted.length;
  let size = directory;
  const placed = sorted.map((table) => {
    const offset = size;
    size += Math.ceil(table.bytes.length / 4) * 4;
    return { ...table, offset };
  });
  checkSize(size, 'decoded font');
  const out = new Uint8Array(size);
  const writer = viewOf(out);
  const count = sorted.length;
  const entrySelector = count === 0 ? 0 : Math.floor(Math.log2(count));
  const searchRange = count === 0 ? 0 : 2 ** entrySelector * 16;
  writer.setUint32(0, flavor);
  writer.setUint16(4, count);
  writer.setUint16(6, searchRange);
  writer.setUint16(8, entrySelector);
  writer.setUint16(10, count * 16 - searchRange);
  let headOffset: number | undefined;
  placed.forEach((table, index) => {
    const { bytes, offset } = table;
    if (isRebuilt && table.tag === HEAD && bytes.length >= 12) {
      const head = bytes.slice();
      viewOf(head).setUint32(8, 0);
      out.set(head, offset);
      headOffset = offset;
    } else {
      out.set(bytes, offset);
    }
    const record = 12 + index * 16;
    writer.setUint32(record, table.tag);
    writer.setUint32(
      record + 4,
      isRebuilt || table.checksum === undefined
        ? checksumOf(out.subarray(offset, offset + bytes.length))
        : table.checksum,
    );
    writer.setUint32(record + 8, offset);
    writer.setUint32(record + 12, bytes.length);
  });
  if (headOffset !== undefined) {
    writer.setUint32(headOffset + 8, (0xb1b0afba - checksumOf(out)) >>> 0);
  }
  return out;
}

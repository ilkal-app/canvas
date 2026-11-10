// WOFF2: one brotli stream of every table, decoded by brotli's JavaScript decoder
// (imported only when a WOFF2 arrives), its transformed glyf, loca and hmtx rebuilt.

import { ByteReader } from './byte-reader.js';
import { FontFormatError } from './font-format-error.js';
import { type SfntTable, writeSfnt } from './sfnt-writer.js';
import { checkFlavor, checkSize, tagName, tagValue, viewOf } from './web-font-bytes.js';
import { rebuildGlyphs, type RebuiltGlyphs } from './woff2-glyf.js';

/** The bytes of a WOFF2 header. */
const WOFF2_HEADER_BYTES = 48;
/** The tags a WOFF2 table directory entry names by index (its flags' low six bits). */
const KNOWN_TAGS = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
  'EBSC',
  'JSTF',
  'MATH',
  'CBDT',
  'CBLC',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'acnt',
  'avar',
  'bdat',
  'bloc',
  'bsln',
  'cvar',
  'fdsc',
  'feat',
  'fmtx',
  'fvar',
  'gvar',
  'hsty',
  'just',
  'lcar',
  'mort',
  'morx',
  'opbd',
  'prop',
  'trak',
  'Zapf',
  'Silf',
  'Glat',
  'Gloc',
  'Feat',
  'Sill',
].map(tagValue);
const GLYF = tagValue('glyf');
const LOCA = tagValue('loca');
const HMTX = tagValue('hmtx');
const HHEA = tagValue('hhea');
const MAXP = tagValue('maxp');

/** One WOFF2 table: its tag, its length in the font, and where it is in the decoded stream. */
interface Woff2Entry {
  readonly tag: number;
  readonly length: number;
  readonly isTransformed: boolean;
  readonly start: number;
  readonly end: number;
}

/** The decoder, once imported (brotli's JavaScript port, MIT). */
let brotliDecoder: Promise<(buffer: Uint8Array, outputSize?: number) => Uint8Array> | undefined;

/**
 * Reads a WOFF2 table directory: each table's tag, its length in the font, whether it is
 * transformed, and where its bytes are in the decoded stream.
 *
 * @param reader - The file, at the directory.
 * @param count - Its tables.
 * @returns The tables, and the bytes the stream must decode to.
 * @throws {FontFormatError} When an entry is malformed, names a transform WOFF2 does not define,
 *   or declares sizes past the limit.
 */
function readDirectory(
  reader: ByteReader,
  count: number,
): { entries: Woff2Entry[]; streamLength: number } {
  const entries: Woff2Entry[] = [];
  let streamLength = 0;
  for (let index = 0; index < count; index += 1) {
    const flags = reader.uint8();
    const known = flags & 0x3f;
    const tag = known === 0x3f ? reader.uint32() : (KNOWN_TAGS[known] ?? 0);
    if (tag === 0) throw new FontFormatError('A WOFF2 table names an unknown tag index.');
    const version = flags >> 6;
    const length = reader.base128();
    checkSize(length, `WOFF2 table ${tagName(tag)}`);
    // glyf and loca are transformed at version 0 and stored at 3, the only two versions WOFF2
    // defines for them; every other table is stored at 0, and only hmtx has a transform (1).
    const isGlyphTable = tag === GLYF || tag === LOCA;
    if (isGlyphTable && version !== 0 && version !== 3) {
      throw new FontFormatError(`WOFF2 table ${tagName(tag)} has an unknown transform.`);
    }
    const isTransformed = isGlyphTable ? version === 0 : version !== 0;
    if (isTransformed && !isGlyphTable && !(tag === HMTX && version === 1)) {
      throw new FontFormatError(`WOFF2 table ${tagName(tag)} has an unknown transform.`);
    }
    const stored = isTransformed ? reader.base128() : length;
    checkSize(stored, `WOFF2 table ${tagName(tag)}`);
    entries.push({ tag, length, isTransformed, start: streamLength, end: streamLength + stored });
    streamLength += stored;
    checkSize(streamLength, 'WOFF2 stream');
  }
  return { entries, streamLength };
}

/**
 * Unwraps a WOFF2 file: its brotli stream decoded, then each table taken from it, the transformed
 * `glyf`, `loca` and `hmtx` rebuilt, and the whole laid out as an sfnt.
 *
 * @param source - The file.
 * @returns The sfnt.
 * @throws {FontFormatError} When the file is truncated, inconsistent or a collection, or a stream
 *   is corrupt.
 */
export async function decodeWoff2(source: Uint8Array): Promise<Uint8Array> {
  if (source.length < WOFF2_HEADER_BYTES) {
    throw new FontFormatError('The WOFF2 header is truncated.');
  }
  const view = viewOf(source);
  const flavor = view.getUint32(4);
  if (view.getUint32(8) !== source.length) {
    throw new FontFormatError('The WOFF2 header gives a length other than the file’s.');
  }
  checkFlavor(flavor, 'WOFF2');
  const count = view.getUint16(12);
  checkSize(view.getUint32(16), 'WOFF2 header’s sfnt size');
  const compressedSize = view.getUint32(20);
  const reader = new ByteReader(source, WOFF2_HEADER_BYTES);
  const { entries, streamLength } = readDirectory(reader, count);
  if (reader.at + compressedSize > source.length) {
    throw new FontFormatError('The WOFF2 stream runs past the end of the file.');
  }
  const stream = await decodeBrotli(
    source.subarray(reader.at, reader.at + compressedSize),
    streamLength,
  );
  const bytesOf = (entry: Woff2Entry): Uint8Array => stream.subarray(entry.start, entry.end);
  const byTag = new Map(entries.map((entry) => [entry.tag, entry]));
  const glyfEntry = byTag.get(GLYF);
  const locaEntry = byTag.get(LOCA);
  if ((glyfEntry === undefined) !== (locaEntry === undefined)) {
    throw new FontFormatError('A WOFF2 file must have both glyf and loca or neither.');
  }
  let rebuilt: RebuiltGlyphs | undefined;
  if (glyfEntry !== undefined && locaEntry !== undefined) {
    if (glyfEntry.isTransformed !== locaEntry.isTransformed) {
      throw new FontFormatError('WOFF2 glyf and loca must both be transformed or neither.');
    }
    if (glyfEntry.isTransformed) {
      if (locaEntry.end !== locaEntry.start) {
        throw new FontFormatError('A transformed WOFF2 loca must be empty.');
      }
      rebuilt = rebuildGlyphs(bytesOf(glyfEntry));
      if (rebuilt.loca.length !== locaEntry.length) {
        throw new FontFormatError('The rebuilt loca has a length other than the one declared.');
      }
    }
  }
  const tables = entries.map((entry): SfntTable => {
    if (rebuilt !== undefined && entry.tag === GLYF) return { tag: entry.tag, bytes: rebuilt.glyf };
    if (rebuilt !== undefined && entry.tag === LOCA) return { tag: entry.tag, bytes: rebuilt.loca };
    if (entry.tag === HMTX && entry.isTransformed) {
      return {
        tag: entry.tag,
        bytes: rebuildHmtx(bytesOf(entry), entry.length, byTag, bytesOf, rebuilt),
      };
    }
    // Only glyf, loca and hmtx pass the directory's transform check, and each is rebuilt above.
    return { tag: entry.tag, bytes: bytesOf(entry).slice() };
  });
  return writeSfnt(flavor, tables, true);
}

/**
 * Decodes the brotli stream to exactly the bytes its tables declare.
 *
 * @param data - The compressed stream.
 * @param length - The bytes it must decode to.
 * @returns The decoded stream.
 * @throws {FontFormatError} When the stream is corrupt or decodes to another length.
 */
async function decodeBrotli(data: Uint8Array, length: number): Promise<Uint8Array> {
  brotliDecoder ??= import('brotli/decompress.js').then((module) => module.default);
  const decode = await brotliDecoder;
  let out: Uint8Array;
  try {
    out = decode(data, length);
  } catch {
    throw new FontFormatError('The WOFF2 stream is not a valid brotli stream for its tables.');
  }
  if (out.length !== length) {
    throw new FontFormatError('The WOFF2 stream decodes short of its tables.');
  }
  return out;
}

/**
 * Rebuilds `hmtx` from WOFF2's transformed form: the advances, then each left side bearing
 * the flags keep, the rest taken from the glyphs' xMin.
 *
 * @param data - The transformed table.
 * @param length - The table's length in the font.
 * @param byTag - The file's tables.
 * @param bytesOf - Reads a table's stored bytes.
 * @param rebuilt - The rebuilt glyphs, whose xMins stand for the bearings left out.
 * @returns The table.
 * @throws {FontFormatError} When glyf, hhea or maxp is missing or disagrees, the flags are
 *   invalid, or the table runs short or long.
 */
function rebuildHmtx(
  data: Uint8Array,
  length: number,
  byTag: ReadonlyMap<number, Woff2Entry>,
  bytesOf: (entry: Woff2Entry) => Uint8Array,
  rebuilt: RebuiltGlyphs | undefined,
): Uint8Array {
  const hhea = byTag.get(HHEA);
  const maxp = byTag.get(MAXP);
  if (rebuilt === undefined || hhea === undefined || maxp === undefined) {
    throw new FontFormatError('A transformed WOFF2 hmtx needs a transformed glyf, hhea and maxp.');
  }
  const metricCount = new ByteReader(bytesOf(hhea), 34).uint16();
  const glyphCount = new ByteReader(bytesOf(maxp), 4).uint16();
  if (metricCount === 0 || metricCount > glyphCount || glyphCount !== rebuilt.xMins.length) {
    throw new FontFormatError('The WOFF2 hmtx disagrees with hhea, maxp or glyf.');
  }
  const reader = new ByteReader(data);
  const flags = reader.uint8();
  // Bit 0 leaves out the proportional bearings, bit 1 the monospaced ones; one must be set.
  if ((flags & 0xfc) !== 0 || (flags & 3) === 0) {
    throw new FontFormatError('The WOFF2 hmtx transform has invalid flags.');
  }
  const advances = Array.from({ length: metricCount }, () => reader.uint16());
  const bearing = (glyph: number, isStored: boolean): number =>
    isStored ? reader.int16() : (rebuilt.xMins[glyph] ?? 0);
  const proportional = Array.from({ length: metricCount }, (unused, glyph) =>
    bearing(glyph, (flags & 1) === 0),
  );
  const monospaced = Array.from({ length: glyphCount - metricCount }, (unused, index) =>
    bearing(metricCount + index, (flags & 2) === 0),
  );
  const out = new Uint8Array(4 * metricCount + 2 * (glyphCount - metricCount));
  if (out.length !== length) {
    throw new FontFormatError('The rebuilt hmtx has a length other than the one declared.');
  }
  const writer = viewOf(out);
  advances.forEach((advance, index) => {
    writer.setUint16(index * 4, advance);
  });
  proportional.forEach((bearing, index) => {
    writer.setInt16(index * 4 + 2, bearing);
  });
  monospaced.forEach((value, index) => {
    writer.setInt16(4 * metricCount + index * 2, value);
  });
  return out;
}

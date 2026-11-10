import { FontFormatError } from './font-format-error.js';
import type { SfntFile } from './sfnt-file.js';

/** An encoding record of the `cmap` table: which platform and encoding a subtable serves. */
interface EncodingRecord {
  readonly platformId: number;
  readonly encodingId: number;
  readonly offset: number;
}

/**
 * Subtables in order of preference: full Unicode first (format 12, which reaches past the Basic
 * Multilingual Plane), then Unicode BMP (format 4).
 */
const PREFERENCE: readonly (readonly [platformId: number, encodingId: number])[] = [
  [3, 10],
  [0, 6],
  [0, 4],
  [3, 1],
  [0, 3],
];

/** Unicode's last codepoint. */
const LAST_CODEPOINT = 0x10ffff;
/**
 * The most characters a font may map: four times the most glyphs a font can hold,
 * far past any real face (a full CJK face maps about 45,000), so a few bytes of format 12 cannot
 * make the parser fill a map of all of Unicode.
 */
const MAX_MAPPED_CODEPOINTS = 4 * 65_536;

/**
 * Refuses a character map past {@link MAX_MAPPED_CODEPOINTS}.
 *
 * @param mapping - The codepoints mapped so far.
 * @param count - How many more a group would visit.
 * @throws {FontFormatError} When they would pass the limit.
 */
function checkMappedCount(mapping: ReadonlyMap<number, number>, count: number): void {
  if (mapping.size + count > MAX_MAPPED_CODEPOINTS) {
    throw new FontFormatError('The cmap maps more characters than any font can.');
  }
}

function readEncodingRecords(cmap: DataView): EncodingRecord[] {
  const count = cmap.getUint16(2);
  const records: EncodingRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const record = 4 + index * 8;
    records.push({
      platformId: cmap.getUint16(record),
      encodingId: cmap.getUint16(record + 2),
      offset: cmap.getUint32(record + 4),
    });
  }
  return records;
}

/**
 * Reads a format 12 subtable: sequential groups of characters mapping to sequential glyphs.
 *
 * @param cmap - The `cmap` table.
 * @param offset - The subtable's offset in the table.
 * @param into - Receives codepoint → glyph id.
 */
function readSegmentedCoverage(cmap: DataView, offset: number, into: Map<number, number>): void {
  const groupCount = cmap.getUint32(offset + 12);
  // Groups are sorted and disjoint (OpenType `cmap` format 12); each codepoint is visited once at
  // most, and none past Unicode's last, so a hostile table cannot loop billions of times.
  let next = 0;
  for (let group = 0; group < groupCount; group += 1) {
    const record = offset + 16 + group * 12;
    const start = Math.max(cmap.getUint32(record), next);
    const end = Math.min(cmap.getUint32(record + 4), LAST_CODEPOINT);
    const startGlyph = cmap.getUint32(record + 8) - cmap.getUint32(record) + start;
    next = Math.max(next, end + 1);
    checkMappedCount(into, Math.max(0, end - start + 1));
    for (let codepoint = start; codepoint <= end; codepoint += 1) {
      const glyphId = startGlyph + codepoint - start;
      if (glyphId !== 0) into.set(codepoint, glyphId);
    }
  }
}

/**
 * Reads a format 4 subtable: BMP segments with a delta or an offset into the glyph id array.
 *
 * @param cmap - The `cmap` table.
 * @param offset - The subtable's offset in the table.
 * @param into - Receives codepoint → glyph id.
 */
function readSegmentMapping(cmap: DataView, offset: number, into: Map<number, number>): void {
  const segmentCount = cmap.getUint16(offset + 6) / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;
  // Segments are sorted by end code; as for format 12, each codepoint is visited once at most.
  let next = 0;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const end = cmap.getUint16(endCodes + segment * 2);
    const declaredStart = cmap.getUint16(startCodes + segment * 2);
    const start = Math.max(declaredStart, next);
    next = Math.max(next, end + 1);
    const delta = cmap.getInt16(deltas + segment * 2);
    const rangeOffsetAt = rangeOffsets + segment * 2;
    const rangeOffset = cmap.getUint16(rangeOffsetAt);
    for (let codepoint = start; codepoint <= end && codepoint !== 0xffff; codepoint += 1) {
      let glyphId: number;
      if (rangeOffset === 0) {
        glyphId = (codepoint + delta) & 0xffff;
      } else {
        // The offset is relative to the idRangeOffset entry itself (OpenType `cmap` format 4).
        const raw = cmap.getUint16(rangeOffsetAt + rangeOffset + (codepoint - declaredStart) * 2);
        glyphId = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyphId !== 0) into.set(codepoint, glyphId);
    }
  }
}

/**
 * Reads the font's Unicode character map (`cmap` format 12 or 4).
 *
 * @param file - The font file.
 * @returns Every mapped codepoint with its glyph id; unmapped codepoints are absent (they show
 *   the `.notdef` glyph, id 0).
 * @throws {FontFormatError} When the font has no Unicode subtable in a supported format.
 */
export function readCharacterMap(file: SfntFile): Map<number, number> {
  const cmap = file.table('cmap');
  const records = readEncodingRecords(cmap);
  for (const [platformId, encodingId] of PREFERENCE) {
    const record = records.find(
      (candidate) => candidate.platformId === platformId && candidate.encodingId === encodingId,
    );
    if (record === undefined) continue;
    const format = cmap.getUint16(record.offset);
    const mapping = new Map<number, number>();
    if (format === 12) {
      readSegmentedCoverage(cmap, record.offset, mapping);
      return mapping;
    }
    if (format === 4) {
      readSegmentMapping(cmap, record.offset, mapping);
      return mapping;
    }
  }
  throw new FontFormatError("The 'cmap' table has no Unicode subtable in format 4 or 12.");
}

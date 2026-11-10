/**
 * A half-open byte range `[start, end)` of an instance buffer: the unit of a dirty-range upload.
 * Both ends are multiples of 4.
 */
export type ByteRange = readonly [start: number, end: number];

/**
 * Coalesces dirty instance records into the byte ranges to upload. Adjacent records merge into
 * one range, and ranges separated by at most `maxGapBytes` of clean records merge too: one
 * `writeBuffer` call has a fixed cost, so re-sending a few clean bytes is cheaper than a second
 * call.
 *
 * @param records - The dirty record indices, in any order, without duplicates.
 * @param strideBytes - Bytes per record; a multiple of 4.
 * @param maxGapBytes - The widest run of clean bytes a merged range may span; 0 merges only
 *   touching records.
 * @param dirtyFlags - Optional existing slot bitmap matching records; dense updates scan it
 *   instead of allocating and sorting. It is never retained or changed.
 * @returns The ranges, ascending and disjoint.
 * @throws {RangeError} When `maxGapBytes` is negative.
 */
export function coalesceDirtyRecords(
  records: readonly number[],
  strideBytes: number,
  maxGapBytes: number,
  dirtyFlags?: Uint8Array,
): ByteRange[] {
  if (maxGapBytes < 0) {
    throw new RangeError(`maxGapBytes must be at least 0; received ${String(maxGapBytes)}.`);
  }
  let first = 0;
  let span = 0;
  if (dirtyFlags !== undefined && records.length >= 64) {
    let min = Infinity;
    let max = -Infinity;
    let hasValidIndices = true;
    for (const record of records) {
      min = Math.min(min, record);
      max = Math.max(max, record);
      hasValidIndices &&= Number.isInteger(record);
    }
    if (
      hasValidIndices &&
      min >= 0 &&
      max < dirtyFlags.length &&
      max - min + 1 <= records.length * 4
    ) {
      first = min;
      span = max - min + 1;
    }
  }
  const sorted = span === 0 ? Int32Array.from(records).sort() : undefined;
  const ranges: ByteRange[] = [];
  let start = -1;
  let end = -1;
  const count = sorted?.length ?? span;
  for (let index = 0; index < count; index += 1) {
    const record = sorted?.[index] ?? first + index;
    if (sorted === undefined && dirtyFlags?.[record] === 0) continue;
    const recordStart = record * strideBytes;
    if (start >= 0 && recordStart - end <= maxGapBytes) {
      end = recordStart + strideBytes;
      continue;
    }
    if (start >= 0) ranges.push([start, end]);
    start = recordStart;
    end = recordStart + strideBytes;
  }
  if (start >= 0) ranges.push([start, end]);
  return ranges;
}

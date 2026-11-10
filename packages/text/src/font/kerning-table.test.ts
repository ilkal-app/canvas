import { describe, expect, it } from 'vitest';

import { buildSfnt, ByteWriter } from '../__fixtures__/sfnt-builder.js';

import { kerningKey, readKerningPairs } from './kerning-table.js';
import { SfntFile } from './sfnt-file.js';

/**
 * Writes a version-0 `kern` subtable of format 0.
 *
 * @param coverageBits - The subtable's coverage field.
 * @param pairs - `[left, right, value]` in font units.
 * @returns The subtable's bytes.
 */
function formatZero(coverageBits: number, pairs: readonly [number, number, number][]): ByteWriter {
  const writer = new ByteWriter().u16(0, 14 + pairs.length * 6, coverageBits);
  writer.u16(pairs.length, 0, 0, 0);
  for (const [left, right, value] of pairs) writer.u16(left, right, value);
  return writer;
}

function kernTable(...subtables: ByteWriter[]): SfntFile {
  const table = new ByteWriter().u16(0, subtables.length);
  for (const subtable of subtables) table.raw(subtable.toBytes());
  return new SfntFile(buildSfnt({ kern: table.toBytes() }));
}

describe('readKerningPairs', () => {
  it('reads horizontal format 0 pairs in em', () => {
    const pairs = readKerningPairs(kernTable(formatZero(0x01, [[1, 2, -100]])), 1000);
    expect(pairs.get(kerningKey(1, 2))).toBe(-0.1);
  });

  it('adds subtables together unless a subtable overrides', () => {
    const summed = kernTable(formatZero(0x01, [[1, 2, -100]]), formatZero(0x01, [[1, 2, -50]]));
    expect(readKerningPairs(summed, 1000).get(kerningKey(1, 2))).toBe(-0.15);
    const overridden = kernTable(formatZero(0x01, [[1, 2, -100]]), formatZero(0x09, [[1, 2, -50]]));
    expect(readKerningPairs(overridden, 1000).get(kerningKey(1, 2))).toBe(-0.05);
  });

  it('skips vertical, minimum, cross-stream and non-zero formats', () => {
    const skipped = kernTable(
      formatZero(0x00, [[1, 2, -1]]),
      formatZero(0x03, [[1, 3, -1]]),
      formatZero(0x05, [[1, 4, -1]]),
      new ByteWriter().u16(0, 8, 0x0201, 0),
      formatZero(0x01, [[1, 5, -1]]),
    );
    expect([...readKerningPairs(skipped, 1).keys()]).toEqual([kerningKey(1, 5)]);
  });

  it('ignores Apple version 1 tables and fonts without kern', () => {
    const apple = new SfntFile(buildSfnt({ kern: new ByteWriter().u32(0x00010000, 0).toBytes() }));
    expect(readKerningPairs(apple, 1000).size).toBe(0);
    expect(readKerningPairs(new SfntFile(buildSfnt({ head: new Uint8Array(4) })), 1).size).toBe(0);
  });
});

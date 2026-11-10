import { describe, expect, it } from 'vitest';

import { buildSfnt, ByteWriter } from '../__fixtures__/sfnt-builder.js';

import { readCharacterMap } from './character-map.js';
import { FontFormatError } from './font-format-error.js';
import { SfntFile } from './sfnt-file.js';

function cmapWith(platformId: number, encodingId: number, subtable: Uint8Array): SfntFile {
  const cmap = new ByteWriter().u16(0, 1).u16(platformId, encodingId).u32(12).raw(subtable);
  return new SfntFile(buildSfnt({ cmap: cmap.toBytes() }));
}

describe('readCharacterMap', () => {
  it('reads format 12 groups, beyond the Basic Multilingual Plane', () => {
    const groups = new ByteWriter()
      .u16(12, 0)
      .u32(16 + 2 * 12, 0, 2)
      .u32(0x41, 0x43, 10)
      .u32(0x1f600, 0x1f600, 0);
    const mapping = readCharacterMap(cmapWith(3, 10, groups.toBytes()));
    expect([...mapping]).toEqual([
      [0x41, 10],
      [0x42, 11],
      [0x43, 12],
    ]);
  });

  it('reads format 4 segments by delta and by glyph id array, skipping the 0xFFFF sentinel', () => {
    // Two segments: 'a'..'c' via idRangeOffset into the glyph array, and the 0xFFFF sentinel.
    const segment = new ByteWriter()
      .u16(4, 0, 0, 4, 0, 0, 0) // format, length, language, segCountX2, search fields
      .u16(0x63, 0xffff) // endCode
      .u16(0) // reservedPad
      .u16(0x61, 0xffff) // startCode
      .u16(5, 1) // idDelta
      .u16(4, 0) // idRangeOffset: from its own slot to glyphIdArray[0]
      .u16(7, 0, 9); // glyphIdArray: 'a' → 7 + 5, 'b' → 0 (unmapped), 'c' → 9 + 5
    const mapping = readCharacterMap(cmapWith(3, 1, segment.toBytes()));
    expect([...mapping]).toEqual([
      [0x61, 12],
      [0x63, 14],
    ]);
  });

  it('maps by delta alone when a segment has no glyph id array', () => {
    const segment = new ByteWriter()
      .u16(4, 0, 0, 4, 0, 0, 0)
      .u16(0x31, 0xffff)
      .u16(0)
      .u16(0x30, 0xffff)
      .u16(-0x2e, 1)
      .u16(0, 0);
    expect([...readCharacterMap(cmapWith(0, 3, segment.toBytes()))]).toEqual([
      [0x30, 2],
      [0x31, 3],
    ]);
  });

  it('rejects a font with no Unicode subtable in a supported format', () => {
    const format6 = new ByteWriter().u16(6, 0, 0, 0, 0).toBytes();
    expect(() => readCharacterMap(cmapWith(3, 1, format6))).toThrow(FontFormatError);
    expect(() => readCharacterMap(cmapWith(1, 0, format6))).toThrow(/Unicode/);
  });

  it('clamps format 12 groups to Unicode and maps each codepoint once, first group first', () => {
    // A group reaching 0xFFFFFFFF would loop four billion times; overlapping groups would repeat.
    const groups = new ByteWriter()
      .u16(12, 0)
      .u32(16 + 3 * 12, 0, 3)
      .u32(0x10ff00, 0xffffffff, 1)
      .u32(0x10ff80, 0x10ffff, 5000)
      .u32(0x41, 0x41, 7);
    const mapping = readCharacterMap(cmapWith(3, 10, groups.toBytes()));
    expect(mapping.size).toBe(256);
    expect(mapping.get(0x10ff80)).toBe(0x81);
    expect(mapping.get(0x10ffff)).toBe(0x100);
    expect(mapping.has(0x41)).toBe(false);
  });

  it('maps each codepoint of overlapping format 4 segments once, first segment first', () => {
    const segment = new ByteWriter()
      .u16(4, 0, 0, 6, 0, 0, 0)
      .u16(0x7f, 0x7f, 0xffff) // endCode
      .u16(0)
      .u16(0x20, 0x40, 0xffff) // startCode: the second segment overlaps the first
      .u16(1, 100, 1) // idDelta
      .u16(0, 0, 0); // idRangeOffset
    const mapping = readCharacterMap(cmapWith(3, 1, segment.toBytes()));
    expect(mapping.size).toBe(0x60);
    expect(mapping.get(0x40)).toBe(0x41);
  });

  it('refuses a format 12 table mapping more characters than any font can', () => {
    // Sixteen bytes of group covering all of Unicode would fill a map of 1.1 million entries.
    const groups = new ByteWriter()
      .u16(12, 0)
      .u32(16 + 12, 0, 1)
      .u32(0, 0x10ffff, 1);
    expect(() => readCharacterMap(cmapWith(3, 10, groups.toBytes()))).toThrow(FontFormatError);
  });
});

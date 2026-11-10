import { describe, expect, it } from 'vitest';

import { glyphCountOf, sbixPlacement } from './sbix-placement.js';

/** Glyphs in the test font: 0, 1 and 2. */
const GLYPHS = 3;

/** One glyph record of a strike. */
interface TestRecord {
  readonly tag: string;
  readonly x?: number;
  readonly y?: number;
  /** For a `dupe` record, the glyph it names. */
  readonly dupeOf?: number;
}

/**
 * An sbix table of strikes, each with records for some of glyphs 0..2.
 *
 * @param strikes - Each strike's ppem and its records by glyph id.
 * @returns The table's bytes.
 */
function sbixTable(
  strikes: readonly { ppem: number; records: Readonly<Record<number, TestRecord>> }[],
): Uint8Array {
  const parts: number[][] = [];
  for (const strike of strikes) {
    const arrayBytes = 4 + (GLYPHS + 1) * 4;
    const data: number[] = [];
    const offsets: number[] = [];
    for (let glyph = 0; glyph < GLYPHS; glyph += 1) {
      offsets.push(arrayBytes + data.length);
      const record = strike.records[glyph];
      if (record === undefined) continue;
      const header = new Uint8Array(8);
      const view = new DataView(header.buffer);
      view.setInt16(0, record.x ?? 0);
      view.setInt16(2, record.y ?? 0);
      for (let index = 0; index < 4; index += 1) header[4 + index] = record.tag.charCodeAt(index);
      data.push(...header, ...(record.dupeOf === undefined ? [1, 2, 3, 4] : [0, record.dupeOf]));
    }
    offsets.push(arrayBytes + data.length);
    const head = new Uint8Array(arrayBytes);
    const view = new DataView(head.buffer);
    view.setUint16(0, strike.ppem);
    view.setUint16(2, 72);
    offsets.forEach((offset, index) => {
      view.setUint32(4 + index * 4, offset);
    });
    parts.push([...head, ...data]);
  }
  const headerBytes = 8 + strikes.length * 4;
  const total = headerBytes + parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1);
  view.setUint32(4, strikes.length);
  let at = headerBytes;
  parts.forEach((part, index) => {
    view.setUint32(8 + index * 4, at);
    bytes.set(part, at);
    at += part.length;
  });
  return bytes;
}

describe('sbixPlacement', () => {
  it('reads the glyph in the strike of the largest ppem, as HarfBuzz does', () => {
    const table = sbixTable([
      { ppem: 20, records: { 1: { tag: 'png ', x: 1, y: -2 } } },
      { ppem: 160, records: { 1: { tag: 'png ', x: 8, y: -16 } } },
      { ppem: 40, records: { 1: { tag: 'png ', x: 2, y: -4 } } },
    ]);
    expect(sbixPlacement(table, 1, GLYPHS)).toEqual({ ppem: 160, originX: 8, originY: -16 });
  });

  it('gives none when the largest strike lacks the glyph, though a smaller one has it', () => {
    const table = sbixTable([
      { ppem: 20, records: { 1: { tag: 'png ' } } },
      { ppem: 160, records: { 2: { tag: 'png ' } } },
    ]);
    expect(sbixPlacement(table, 1, GLYPHS)).toBeUndefined();
  });

  it('gives none for another graphic type in that strike (a larger JPEG over a PNG)', () => {
    const table = sbixTable([
      { ppem: 20, records: { 1: { tag: 'png ' } } },
      { ppem: 160, records: { 1: { tag: 'jpg ' } } },
    ]);
    expect(sbixPlacement(table, 1, GLYPHS)).toBeUndefined();
  });

  it("follows a dupe record to the glyph it names, and that glyph's placement", () => {
    const table = sbixTable([
      { ppem: 64, records: { 1: { tag: 'png ', x: 3, y: -5 }, 2: { tag: 'dupe', dupeOf: 1 } } },
    ]);
    expect(sbixPlacement(table, 2, GLYPHS)).toEqual({ ppem: 64, originX: 3, originY: -5 });
    const looping = sbixTable([
      { ppem: 64, records: { 1: { tag: 'dupe', dupeOf: 2 }, 2: { tag: 'dupe', dupeOf: 1 } } },
    ]);
    expect(sbixPlacement(looping, 1, GLYPHS)).toBeUndefined();
    const outside = sbixTable([{ ppem: 64, records: { 1: { tag: 'dupe', dupeOf: 9 } } }]);
    expect(sbixPlacement(outside, 1, GLYPHS)).toBeUndefined();
  });

  it('gives none for a glyph out of range or a malformed table', () => {
    const table = sbixTable([{ ppem: 20, records: { 1: { tag: 'png ' } } }]);
    expect(sbixPlacement(table, GLYPHS, GLYPHS)).toBeUndefined();
    expect(sbixPlacement(table, -1, GLYPHS)).toBeUndefined();
    expect(sbixPlacement(new Uint8Array(4), 1, GLYPHS)).toBeUndefined();
    expect(sbixPlacement(table.slice(0, 20), 1, GLYPHS)).toBeUndefined();
    // A glyph count larger than the strike's offset array reaches past the table.
    expect(sbixPlacement(table, 1, 1_000)).toBeUndefined();
    const overlapping = table.slice();
    new DataView(overlapping.buffer).setUint32(12 + 8, 0); // glyph 1 starts inside the offsets
    expect(sbixPlacement(overlapping, 1, GLYPHS)).toBeUndefined();
    const manyStrikes = table.slice();
    new DataView(manyStrikes.buffer).setUint32(4, 1_000);
    expect(sbixPlacement(manyStrikes, 1, GLYPHS)).toBeUndefined();
  });
});

describe('glyphCountOf', () => {
  it('reads maxp numGlyphs, and 0 for a short table', () => {
    const maxp = new Uint8Array(6);
    new DataView(maxp.buffer).setUint16(4, 321);
    expect(glyphCountOf(maxp)).toBe(321);
    expect(glyphCountOf(new Uint8Array(4))).toBe(0);
  });
});

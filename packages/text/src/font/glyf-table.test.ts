import { describe, expect, it } from 'vitest';

import { buildSfnt, ByteWriter } from '../__fixtures__/sfnt-builder.js';

import { FontFormatError } from './font-format-error.js';
import { GlyfTable } from './glyf-table.js';
import type { GlyphOutline } from './glyph-outline.js';
import { SfntFile } from './sfnt-file.js';

const UNITS_PER_EM = 100;

/** A 100-unit square from on-curve points, coordinates packed as short deltas. */
const SQUARE = new ByteWriter()
  .u16(1, 0, 0, 100, 100) // one contour and its bounding box
  .u16(3, 0) // last point index, no instructions
  .u8(0x31, 0x33, 0x35, 0x23) // flags: on-curve; x same/+short/same/-short; y same/same/+short/same
  .u8(100, 100) // x deltas: +100, -100
  .u8(100) // y delta: +100
  .toBytes();

/** A diamond of four off-curve points, the flag repeated, coordinates as 16-bit words. */
const DIAMOND = new ByteWriter()
  .u16(1, 0, 0, 100, 100)
  .u16(3, 0)
  .u8(0x08, 3) // one off-curve flag, repeated three more times
  .u16(50, 50, -50, -50) // x deltas
  .u16(0, 50, 50, -50) // y deltas
  .toBytes();

/** Four placements of the square: byte offset, word offset + scale, x/y scale, 2×2 rotation. */
const COMPOSITE = new ByteWriter()
  .u16(-1, 0, 0, 0, 0)
  .u16(0x0022, 1)
  .u8(10, 20)
  .u16(0x002b, 1, -300, 0, 0x2000)
  .u16(0x0062, 1)
  .u8(0, 0)
  .u16(0x6000, 0x1000)
  .u16(0x0080, 1)
  .u8(1, 2)
  .u16(0, 0x4000, 0xc000, 0)
  .toBytes();

const SELF_REFERENCE = new ByteWriter().u16(-1, 0, 0, 0, 0, 0x0002, 4).u8(0, 0).toBytes();
const NESTED = new ByteWriter().u16(-1, 0, 0, 0, 0, 0x0003, 3, 1000, 0).toBytes();

/**
 * Builds a glyf/loca pair holding glyphs 0 empty, 1 square, 2 diamond, 3 composite, 4 cyclic
 * and 5 a composite of 3.
 *
 * @param format - The loca format: 0 for 16-bit offsets, 1 for 32-bit.
 * @returns The decoder over those tables.
 */
function table(format: 0 | 1 = 1): GlyfTable {
  const glyphs = [new Uint8Array(0), SQUARE, DIAMOND, COMPOSITE, SELF_REFERENCE, NESTED];
  const glyf = new ByteWriter();
  const loca = new ByteWriter();
  for (const glyph of glyphs) {
    if (format === 1) loca.u32(glyf.length);
    else loca.u16(glyf.length / 2);
    glyf.raw(glyph);
    if (glyf.length % 2 === 1) glyf.u8(0);
  }
  if (format === 1) loca.u32(glyf.length);
  else loca.u16(glyf.length / 2);
  const file = new SfntFile(buildSfnt({ glyf: glyf.toBytes(), loca: loca.toBytes() }));
  return new GlyfTable(file, format, UNITS_PER_EM, glyphs.length);
}

/**
 * Lists each contour's segment start points.
 *
 * @param outline - A decoded outline.
 * @returns The points in font units, rounded to remove float noise.
 */
function corners(outline: GlyphOutline): number[][][] {
  return outline.contours.map((contour) =>
    contour.map((segment) => [
      Math.round(segment.x0 * UNITS_PER_EM),
      Math.round(segment.y0 * UNITS_PER_EM),
    ]),
  );
}

describe('GlyfTable', () => {
  it('decodes a simple glyph from short, same and repeated coordinates', () => {
    const outline = table().outline(1);
    expect(outline.contours[0]?.every((segment) => segment.kind === 'line')).toBe(true);
    expect(corners(outline)).toEqual([
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
    ]);
  });

  it('reads 16-bit loca offsets as half the byte offset', () => {
    expect(corners(table(0).outline(1))).toEqual(corners(table(1).outline(1)));
  });

  it('starts an all-off-curve contour at the implied point between its first two points', () => {
    const [contour] = table().outline(2).contours;
    expect(contour?.map((segment) => segment.kind)).toEqual([
      'quadratic',
      'quadratic',
      'quadratic',
      'quadratic',
    ]);
    expect(corners(table().outline(2))).toEqual([
      [
        [75, 25],
        [75, 75],
        [25, 75],
        [25, 25],
      ],
    ]);
  });

  it('places components by offset, uniform scale, x/y scale and a 2×2 transform', () => {
    expect(corners(table().outline(3))).toEqual([
      [
        [10, 20],
        [110, 20],
        [110, 120],
        [10, 120],
      ],
      [
        [-300, 0],
        [-250, 0],
        [-250, 50],
        [-300, 50],
      ],
      [
        [0, 0],
        [150, 0],
        [150, 25],
        [0, 25],
      ],
      [
        [0, 0],
        [0, 100],
        [-100, 100],
        [-100, 0],
      ],
    ]);
  });

  it('composes the transforms of nested components', () => {
    const nested = corners(table().outline(5));
    expect(nested[0]?.[0]).toEqual([1010, 20]);
    expect(nested[3]?.[2]).toEqual([900, 100]);
  });

  it('returns no contours for an empty or out-of-range glyph', () => {
    expect(table().outline(0).contours).toEqual([]);
    expect(table().outline(99).contours).toEqual([]);
  });

  it('rejects components nested past the depth limit, such as a cycle', () => {
    expect(() => table().outline(4)).toThrow(FontFormatError);
  });

  it('refuses a composite whose components fan out past the visit budget', () => {
    // Glyphs 1 to 4 each hold ten components of the next; glyph 5 is the square: 11,111 visits.
    const fanOut = (next: number): Uint8Array => {
      const glyph = new ByteWriter().u16(-1, 0, 0, 0, 0);
      for (let component = 0; component < 10; component += 1) {
        glyph.u16(component < 9 ? 0x0022 : 0x0002, next).u8(0, 0);
      }
      return glyph.toBytes();
    };
    const glyphs = [new Uint8Array(0), fanOut(2), fanOut(3), fanOut(4), fanOut(5), SQUARE];
    expect(() => tableOf(glyphs).outline(1)).toThrow(/too many components/);
  });

  it('refuses an outline past the point budget, however few its components', () => {
    // A 1,000-point contour, every point at the origin (flags 0x31, repeated), placed 70 times.
    const big = new ByteWriter()
      .u16(1, 0, 0, 0, 0)
      .u16(999, 0)
      .u8(0x39, 255, 0x39, 255, 0x39, 255, 0x39, 231)
      .toBytes();
    const many = new ByteWriter().u16(-1, 0, 0, 0, 0);
    for (let component = 0; component < 70; component += 1) {
      many.u16(component < 69 ? 0x0022 : 0x0002, 1).u8(0, 0);
    }
    const table = tableOf([new Uint8Array(0), big, many.toBytes()]);
    expect(table.outline(1).contours).toHaveLength(1);
    expect(() => table.outline(2)).toThrow(/too many points/);
  });

  it('refuses contours that end out of order before reading their points again', () => {
    // Endpoints 65,535 then 0 would rebuild 65,000 points per pair of contours.
    const backwards = new ByteWriter().u16(2, 0, 0, 0, 0).u16(65_535, 0, 0).toBytes();
    expect(() => tableOf([new Uint8Array(0), backwards]).outline(1)).toThrow(/out of order/);
  });

  it('checks a simple glyph’s points against the budget before decoding them', () => {
    // 40,000 points at the origin; placed twice, the second would pass 65,536.
    const flags: number[] = [];
    for (let pair = 0; pair < 156; pair += 1) flags.push(0x39, 255);
    flags.push(0x39, 63);
    const big = new ByteWriter()
      .u16(1, 0, 0, 0, 0)
      .u16(39_999, 0)
      .u8(...flags)
      .toBytes();
    const twice = new ByteWriter().u16(-1, 0, 0, 0, 0, 0x0022, 1).u8(0, 0).u16(0x0002, 1).u8(0, 0);
    const table = tableOf([new Uint8Array(0), big, twice.toBytes()]);
    expect(() => table.outline(1)).not.toThrow();
    expect(() => table.outline(2)).toThrow(/too many points/);
  });
});

/**
 * Builds a glyf/loca pair of the given glyphs, with 32-bit loca offsets.
 *
 * @param glyphs - The glyphs' data, glyph 0 first.
 * @returns The decoder over those tables.
 */
function tableOf(glyphs: readonly Uint8Array[]): GlyfTable {
  const glyf = new ByteWriter();
  const loca = new ByteWriter();
  for (const glyph of glyphs) {
    loca.u32(glyf.length);
    glyf.raw(glyph);
  }
  loca.u32(glyf.length);
  const file = new SfntFile(buildSfnt({ glyf: glyf.toBytes(), loca: loca.toBytes() }));
  return new GlyfTable(file, 1, UNITS_PER_EM, glyphs.length);
}

// The properties UAX #14 reads, by codepoint, from a range table generated from the
// Unicode Character Database 17.0.0 (`line-break-data.ts`, checked by `line-break-table.test.ts`).
// Each range's value packs a codepoint's Line_Break class (bits 0–5), its East_Asian_Width (bits
// 6–8) and four flags.

import { elementAt } from './element-at.js';
import { LINE_BREAK_RANGE_STARTS, LINE_BREAK_RANGE_VALUES } from './line-break-data.js';

/** The Line_Break property values of Unicode 17.0.0, in the order the table indexes them. */
export const LINE_BREAK_CLASSES = [
  'XX',
  'AI',
  'AK',
  'AL',
  'AP',
  'AS',
  'B2',
  'BA',
  'BB',
  'BK',
  'CB',
  'CJ',
  'CL',
  'CM',
  'CP',
  'CR',
  'EB',
  'EM',
  'EX',
  'GL',
  'H2',
  'H3',
  'HH',
  'HL',
  'HY',
  'ID',
  'IN',
  'IS',
  'JL',
  'JT',
  'JV',
  'LF',
  'NL',
  'NS',
  'NU',
  'OP',
  'PO',
  'PR',
  'QU',
  'RI',
  'SA',
  'SG',
  'SP',
  'SY',
  'VF',
  'VI',
  'WJ',
  'ZW',
  'ZWJ',
] as const;

/** A Line_Break property value. */
export type LineBreakClass = (typeof LINE_BREAK_CLASSES)[number];

/** The East_Asian_Width property values, in the order the table indexes them. */
export const EAST_ASIAN_WIDTHS = ['N', 'A', 'H', 'W', 'F', 'Na'] as const;

/** General_Category Pi: an initial quotation mark. */
export const FLAG_INITIAL_PUNCTUATION = 1 << 9;
/** General_Category Pf: a final quotation mark. */
export const FLAG_FINAL_PUNCTUATION = 1 << 10;
/** General_Category Mn or Mc: a mark, which LB1 resolves SA to CM for. */
export const FLAG_SPACING_OR_NONSPACING_MARK = 1 << 11;
/** Extended_Pictographic and unassigned (Cn): a potential emoji base (LB30b). */
export const FLAG_EXTENDED_PICTOGRAPHIC_UNASSIGNED = 1 << 12;

const CLASS_MASK = 0x3f;
const WIDTH_SHIFT = 6;
const WIDTH_MASK = 0x7;

/** The generated table, decoded: each range's first codepoint and its packed value. */
interface RangeTable {
  /** Each range's first codepoint, ascending, the first 0. */
  readonly starts: Int32Array;
  /** Each range's packed value. */
  readonly values: Uint16Array;
}

let table: RangeTable | undefined;

/**
 * Decodes the generated table.
 *
 * @returns The table.
 */
function decode(): RangeTable {
  const gaps = LINE_BREAK_RANGE_STARTS.split(',');
  const packed = LINE_BREAK_RANGE_VALUES.split(',');
  const starts = new Int32Array(gaps.length);
  const values = new Uint16Array(packed.length);
  let start = 0;
  for (const [index, gap] of gaps.entries()) {
    start += Number.parseInt(gap, 36);
    starts[index] = start;
  }
  for (const [index, value] of packed.entries()) values[index] = Number.parseInt(value, 36);
  return { starts, values };
}

/**
 * The decoded table, decoded on first use.
 *
 * @returns The table.
 */
function rangeTable(): RangeTable {
  table ??= decode();
  return table;
}

/**
 * A codepoint's packed value.
 *
 * @param codepoint - The codepoint, 0 to 0x10FFFF.
 * @returns Its class index, width index and flags.
 */
export function lineBreakValueOf(codepoint: number): number {
  if (codepoint < BMP_SIZE) {
    bmp ??= decodeBmp();
    return elementAt(bmp, codepoint);
  }
  return searchValueOf(codepoint);
}

/** The Basic Multilingual Plane's codepoints, which a dense table answers without a search. */
const BMP_SIZE = 0x10000;
let bmp: Uint16Array | undefined;

/**
 * The Basic Multilingual Plane's values, by codepoint: most text never leaves it.
 *
 * @returns The table.
 */
function decodeBmp(): Uint16Array {
  const { starts, values } = rangeTable();
  const plane = new Uint16Array(BMP_SIZE);
  // Ranges past the BMP follow, so every BMP range has a next one.
  for (let range = 0; elementAt(starts, range) < BMP_SIZE; range += 1) {
    const next = Math.min(elementAt(starts, range + 1), BMP_SIZE);
    plane.fill(elementAt(values, range), elementAt(starts, range), next);
  }
  return plane;
}

/**
 * A codepoint's value, by a binary search of the ranges.
 *
 * @param codepoint - The codepoint.
 * @returns Its packed value.
 */
function searchValueOf(codepoint: number): number {
  const { starts, values } = rangeTable();
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (elementAt(starts, middle) <= codepoint) low = middle;
    else high = middle - 1;
  }
  return elementAt(values, low);
}

/**
 * The Line_Break class of a codepoint (UCD 17.0.0 LineBreak.txt; unlisted codepoints XX).
 *
 * @param codepoint - The codepoint.
 * @returns Its class, such as `AL`, `ID`, `SA` or `BK`.
 */
export function lineBreakClassOf(codepoint: number): LineBreakClass {
  return classOfValue(lineBreakValueOf(codepoint));
}

/**
 * The East_Asian_Width of a codepoint (UCD 17.0.0 EastAsianWidth.txt; unlisted codepoints N).
 *
 * @param codepoint - The codepoint.
 * @returns Its width: `F`, `W`, `H`, `Na`, `A` or `N`.
 */
export function eastAsianWidthOf(codepoint: number): (typeof EAST_ASIAN_WIDTHS)[number] {
  return elementAt(EAST_ASIAN_WIDTHS, (lineBreakValueOf(codepoint) >> WIDTH_SHIFT) & WIDTH_MASK);
}

/**
 * Whether a packed value's East_Asian_Width is Fullwidth, Wide or Halfwidth: UAX #14's
 * `$EastAsian`.
 *
 * @param value - A packed value.
 * @returns Whether it is.
 */
export function isEastAsianValue(value: number): boolean {
  const width = EAST_ASIAN_WIDTHS[(value >> WIDTH_SHIFT) & WIDTH_MASK];
  return width === 'F' || width === 'W' || width === 'H';
}

/**
 * A packed value's class.
 *
 * @param value - A packed value.
 * @returns Its class.
 */
export function classOfValue(value: number): LineBreakClass {
  return elementAt(LINE_BREAK_CLASSES, value & CLASS_MASK);
}

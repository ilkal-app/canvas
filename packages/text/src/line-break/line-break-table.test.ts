/// <reference types="node" />
// The line-break table is generated from the Unicode Character Database 17.0.0 (the
// gzipped files under ../unicode/__fixtures__/ucd-17.0.0): each codepoint's Line_Break class
// (LineBreak.txt, unlisted codepoints XX), East_Asian_Width (EastAsianWidth.txt, unlisted N), and
// the few other properties UAX #14's rules read: General_Category Pi, Pf, Mn and Mc and Cn
// (UnicodeData.txt, unlisted Cn) and Extended_Pictographic (emoji-data.txt). Regenerated with:
//
//   UPDATE_UNICODE_DATA=1 pnpm vitest run --project @canvas/text line-break-table
//   pnpm exec prettier --write packages/text/src/line-break/line-break-data.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  EAST_ASIAN_WIDTHS,
  FLAG_EXTENDED_PICTOGRAPHIC_UNASSIGNED,
  FLAG_FINAL_PUNCTUATION,
  FLAG_INITIAL_PUNCTUATION,
  FLAG_SPACING_OR_NONSPACING_MARK,
  LINE_BREAK_CLASSES,
} from './line-break-class.js';
import { LINE_BREAK_RANGE_STARTS, LINE_BREAK_RANGE_VALUES } from './line-break-data.js';

const UCD = new URL('../unicode/__fixtures__/ucd-17.0.0/', import.meta.url);
const CODEPOINTS = 0x110000;

/**
 * A gzipped UCD file's lines, comments and blanks removed.
 *
 * @param name - The file's name, without `.gz`.
 * @returns Its data lines' fields, trimmed.
 */
function fieldsOf(name: string): string[][] {
  const text = gunzipSync(readFileSync(new URL(`${name}.gz`, UCD))).toString('utf8');
  return text
    .split('\n')
    .map((line) => line.replace(/#.*/u, '').trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(';').map((field) => field.trim()));
}

/**
 * The codepoints a `XXXX` or `XXXX..YYYY` field names.
 *
 * @param field - The field.
 * @returns Its first and last codepoints.
 */
function rangeOf(field: string): [first: number, last: number] {
  const [first = '', last = first] = field.split('..');
  return [Number.parseInt(first, 16), Number.parseInt(last, 16)];
}

/**
 * Every codepoint's packed value, as UCD 17.0.0 gives it.
 *
 * @returns The values, by codepoint.
 * @throws {Error} When a file names a value this table does not know.
 */
function measuredValues(): Uint16Array {
  const values = new Uint16Array(CODEPOINTS);
  const classIndex = new Map<string, number>(
    LINE_BREAK_CLASSES.map((name, index) => [name, index]),
  );
  const widthIndex = new Map<string, number>(EAST_ASIAN_WIDTHS.map((name, index) => [name, index]));
  const lineBreak = new Uint8Array(CODEPOINTS).fill(classIndex.get('XX') ?? 0);
  for (const [range = '', name = ''] of fieldsOf('LineBreak.txt')) {
    const index = classIndex.get(name);
    if (index === undefined) throw new Error(`Unknown line-break class ${name}`);
    const [first, last] = rangeOf(range);
    lineBreak.fill(index, first, last + 1);
  }
  const width = new Uint8Array(CODEPOINTS).fill(widthIndex.get('N') ?? 0);
  for (const [range = '', name = ''] of fieldsOf('EastAsianWidth.txt')) {
    const index = widthIndex.get(name);
    if (index === undefined) throw new Error(`Unknown East_Asian_Width ${name}`);
    const [first, last] = rangeOf(range);
    width.fill(index, first, last + 1);
  }
  // General_Category: unlisted codepoints are Cn; "<…, First>"/"<…, Last>" pairs are ranges.
  const category = new Array<string>(CODEPOINTS).fill('Cn');
  let rangeStart: number | undefined;
  for (const [code = '', name = '', generalCategory = ''] of fieldsOf('UnicodeData.txt')) {
    const codepoint = Number.parseInt(code, 16);
    if (name.endsWith(', First>')) rangeStart = codepoint;
    else if (name.endsWith(', Last>') && rangeStart !== undefined) {
      category.fill(generalCategory, rangeStart, codepoint + 1);
      rangeStart = undefined;
    } else category[codepoint] = generalCategory;
  }
  const pictographic = new Uint8Array(CODEPOINTS);
  for (const [range = '', property = ''] of fieldsOf('emoji-data.txt')) {
    if (property !== 'Extended_Pictographic') continue;
    const [first, last] = rangeOf(range);
    pictographic.fill(1, first, last + 1);
  }
  for (let codepoint = 0; codepoint < CODEPOINTS; codepoint += 1) {
    const generalCategory = category[codepoint];
    let flags = 0;
    if (generalCategory === 'Pi') flags |= FLAG_INITIAL_PUNCTUATION;
    if (generalCategory === 'Pf') flags |= FLAG_FINAL_PUNCTUATION;
    if (generalCategory === 'Mn' || generalCategory === 'Mc')
      flags |= FLAG_SPACING_OR_NONSPACING_MARK;
    if (generalCategory === 'Cn' && pictographic[codepoint] === 1) {
      flags |= FLAG_EXTENDED_PICTOGRAPHIC_UNASSIGNED;
    }
    values[codepoint] = (lineBreak[codepoint] ?? 0) | ((width[codepoint] ?? 0) << 6) | flags;
  }
  return values;
}

/**
 * The values as ranges: where each run of equal values starts, and its value.
 *
 * @param values - The values, by codepoint.
 * @returns The ranges.
 */
function rangesOf(values: Uint16Array): { starts: number[]; packed: number[] } {
  const starts: number[] = [];
  const packed: number[] = [];
  for (let codepoint = 0; codepoint < values.length; codepoint += 1) {
    const value = values[codepoint] ?? 0;
    if (packed.length === 0 || packed.at(-1) !== value) {
      starts.push(codepoint);
      packed.push(value);
    }
  }
  return { starts, packed };
}

/**
 * Numbers as the generated file stores them: base-36, comma-separated, starts as gaps from the
 * previous start.
 *
 * @param numbers - The numbers.
 * @param isDelta - Whether to store each as its gap from the one before.
 * @returns The string.
 */
function encoded(numbers: readonly number[], isDelta: boolean): string {
  return numbers
    .map((value, index) => (isDelta && index > 0 ? value - (numbers[index - 1] ?? 0) : value))
    .map((value) => value.toString(36))
    .join(',');
}

const measured = rangesOf(measuredValues());
const starts = encoded(measured.starts, true);
const values = encoded(measured.packed, false);

if (process.env.UPDATE_UNICODE_DATA === '1') {
  writeFileSync(
    new URL('./line-break-data.ts', import.meta.url),
    [
      '// Generated by src/line-break/line-break-table.test.ts from UCD 17.0.0; do not edit.',
      '',
      '/** Where each range of equal line-break values starts: base-36 gaps from the previous start. */',
      `export const LINE_BREAK_RANGE_STARTS = '${starts}';`,
      '',
      "/** Each range's packed value (`line-break-class.ts`), base-36. */",
      `export const LINE_BREAK_RANGE_VALUES = '${values}';`,
      '',
    ].join('\n'),
  );
}

describe('the line-break table', () => {
  it('holds every codepoint’s UCD 17.0.0 properties', () => {
    expect(LINE_BREAK_RANGE_STARTS).toBe(starts);
    expect(LINE_BREAK_RANGE_VALUES).toBe(values);
  });
});

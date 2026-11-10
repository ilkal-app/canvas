/// <reference types="node" />
// The bidi tables are generated from the Unicode Character Database 17.0.0 (the gzipped
// files under ../unicode/__fixtures__/ucd-17.0.0): each codepoint's Bidi_Class
// (DerivedBidiClass.txt, its `@missing` defaults applied first, in order), its paired bracket
// (BidiBrackets.txt) and its mirrored glyph (BidiMirroring.txt). Regenerated with:
//
//   UPDATE_UNICODE_DATA=1 pnpm vitest run --project @canvas/text bidi-table
//   pnpm exec prettier --write packages/text/src/bidi/bidi-data.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { BIDI_CLASSES } from './bidi-class.js';
import { BIDI_BRACKETS, BIDI_MIRRORS, BIDI_RANGE_STARTS, BIDI_RANGE_VALUES } from './bidi-data.js';

const UCD = new URL('../unicode/__fixtures__/ucd-17.0.0/', import.meta.url);
const CODEPOINTS = 0x110000;

/** Bidi_Class's short names, by the long names `@missing` lines give. */
const LONG_NAMES = new Map<string, string>([
  ['Left_To_Right', 'L'],
  ['Right_To_Left', 'R'],
  ['Arabic_Letter', 'AL'],
  ['European_Number', 'EN'],
  ['European_Separator', 'ES'],
  ['European_Terminator', 'ET'],
  ['Arabic_Number', 'AN'],
  ['Common_Separator', 'CS'],
  ['Nonspacing_Mark', 'NSM'],
  ['Boundary_Neutral', 'BN'],
  ['Paragraph_Separator', 'B'],
  ['Segment_Separator', 'S'],
  ['White_Space', 'WS'],
  ['Other_Neutral', 'ON'],
  ['Left_To_Right_Embedding', 'LRE'],
  ['Left_To_Right_Override', 'LRO'],
  ['Right_To_Left_Embedding', 'RLE'],
  ['Right_To_Left_Override', 'RLO'],
  ['Pop_Directional_Format', 'PDF'],
  ['Left_To_Right_Isolate', 'LRI'],
  ['Right_To_Left_Isolate', 'RLI'],
  ['First_Strong_Isolate', 'FSI'],
  ['Pop_Directional_Isolate', 'PDI'],
]);

/**
 * A gzipped UCD file's text.
 *
 * @param name - The file's name, without `.gz`.
 * @returns Its text.
 */
function textOf(name: string): string {
  return gunzipSync(readFileSync(new URL(`${name}.gz`, UCD))).toString('utf8');
}

/**
 * The data lines of a UCD file, comments and blanks removed.
 *
 * @param text - The file's text.
 * @returns Each line's fields, trimmed.
 */
function fieldsOf(text: string): string[][] {
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
 * Every codepoint's Bidi_Class index, as UCD 17.0.0 gives it.
 *
 * @returns The indices, by codepoint.
 * @throws {Error} When the file names a class this table does not know.
 */
function measuredClasses(): Uint8Array {
  const index = new Map<string, number>(BIDI_CLASSES.map((name, at) => [name, at]));
  const classes = new Uint8Array(CODEPOINTS);
  const text = textOf('DerivedBidiClass.txt');
  const set = (range: string, name: string): void => {
    const at = index.get(name);
    if (at === undefined) throw new Error(`Unknown Bidi_Class ${name}`);
    const [first, last] = rangeOf(range);
    classes.fill(at, first, last + 1);
  };
  for (const match of text.matchAll(/^# @missing: ([0-9A-F.]+); (\w+)$/gmu)) {
    set(match[1] ?? '', LONG_NAMES.get(match[2] ?? '') ?? match[2] ?? '');
  }
  for (const [range = '', name = ''] of fieldsOf(text)) set(range, name);
  return classes;
}

/**
 * The classes as ranges: where each run of one class starts, and its class.
 *
 * @param classes - The classes, by codepoint.
 * @returns Base-36 gaps between starts, and the classes.
 */
function encodedRanges(classes: Uint8Array): { starts: string; values: string } {
  const starts: number[] = [];
  const values: number[] = [];
  for (let codepoint = 0; codepoint < classes.length; codepoint += 1) {
    const value = classes[codepoint] ?? 0;
    if (values.length === 0 || values.at(-1) !== value) {
      starts.push(codepoint);
      values.push(value);
    }
  }
  const gaps = starts.map((start, at) => (at === 0 ? start : start - (starts[at - 1] ?? 0)));
  return {
    starts: gaps.map((gap) => gap.toString(36)).join(','),
    values: values.map((value) => value.toString(36)).join(','),
  };
}

/**
 * The paired brackets: codepoint, its pair, and 0 for an opening bracket or 1 for a closing one.
 *
 * @returns Flat triples, in codepoint order.
 */
function measuredBrackets(): number[] {
  return fieldsOf(textOf('BidiBrackets.txt')).flatMap(([code = '', pair = '', type = '']) => [
    Number.parseInt(code, 16),
    Number.parseInt(pair, 16),
    type === 'o' ? 0 : 1,
  ]);
}

/**
 * The mirrored glyphs: codepoint and its mirror.
 *
 * @returns Flat pairs, in codepoint order.
 */
function measuredMirrors(): number[] {
  return fieldsOf(textOf('BidiMirroring.txt')).flatMap(([code = '', mirror = '']) => [
    Number.parseInt(code, 16),
    Number.parseInt(mirror, 16),
  ]);
}

const ranges = encodedRanges(measuredClasses());
const brackets = measuredBrackets();
const mirrors = measuredMirrors();

if (process.env.UPDATE_UNICODE_DATA === '1') {
  const hex = (values: readonly number[]): string =>
    values.map((value) => `0x${value.toString(16)}`).join(', ');
  writeFileSync(
    new URL('./bidi-data.ts', import.meta.url),
    [
      '// Generated by src/bidi/bidi-table.test.ts from UCD 17.0.0; do not edit.',
      '',
      '/** Where each range of one Bidi_Class starts: base-36 gaps from the previous start. */',
      `export const BIDI_RANGE_STARTS = '${ranges.starts}';`,
      '',
      "/** Each range's Bidi_Class, as an index into `BIDI_CLASSES`, base-36. */",
      `export const BIDI_RANGE_VALUES = '${ranges.values}';`,
      '',
      '/** Paired brackets: codepoint, its pair, 0 opening or 1 closing (BidiBrackets.txt). */',
      `export const BIDI_BRACKETS: readonly number[] = [${hex(brackets)}];`,
      '',
      '/** Mirrored glyphs: codepoint and its mirror (BidiMirroring.txt). */',
      `export const BIDI_MIRRORS: readonly number[] = [${hex(mirrors)}];`,
      '',
    ].join('\n'),
  );
}

describe('the bidi tables', () => {
  it('hold every codepoint’s UCD 17.0.0 Bidi_Class, brackets and mirrors', () => {
    expect(BIDI_RANGE_STARTS).toBe(ranges.starts);
    expect(BIDI_RANGE_VALUES).toBe(ranges.values);
    expect(BIDI_BRACKETS).toEqual(brackets);
    expect(BIDI_MIRRORS).toEqual(mirrors);
  });
});

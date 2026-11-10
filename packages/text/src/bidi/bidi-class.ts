// The character properties the Unicode bidirectional algorithm reads: Bidi_Class,
// Bidi_Paired_Bracket with its type, and Bidi_Mirroring_Glyph, from tables generated from the
// Unicode Character Database 17.0.0 (`bidi-data.ts`, checked by `bidi-table.test.ts`).

import { elementAt } from '../line-break/element-at.js';

import { BIDI_BRACKETS, BIDI_MIRRORS, BIDI_RANGE_STARTS, BIDI_RANGE_VALUES } from './bidi-data.js';

/** The Bidi_Class values, in the order the table indexes them. */
export const BIDI_CLASSES = [
  'L',
  'R',
  'AL',
  'EN',
  'ES',
  'ET',
  'AN',
  'CS',
  'NSM',
  'BN',
  'B',
  'S',
  'WS',
  'ON',
  'LRE',
  'LRO',
  'RLE',
  'RLO',
  'PDF',
  'LRI',
  'RLI',
  'FSI',
  'PDI',
] as const;

/** A Bidi_Class value. */
export type BidiClass = (typeof BIDI_CLASSES)[number];

/** The Basic Multilingual Plane, which a dense table answers without a search. */
const BMP_SIZE = 0x10000;

/** The generated ranges, decoded, and the Basic Multilingual Plane's dense table. */
interface ClassTable {
  /** Each range's first codepoint, ascending, the first 0. */
  readonly starts: Int32Array;
  /** Each range's class index. */
  readonly values: Uint8Array;
  /** Each BMP codepoint's class index. */
  readonly bmp: Uint8Array;
}

let table: ClassTable | undefined;
let brackets: Map<number, PairedBracket> | undefined;
let mirrors: Map<number, number> | undefined;

/**
 * Decodes the generated ranges, and the Basic Multilingual Plane's dense table.
 *
 * @returns The table.
 */
function decode(): ClassTable {
  const gaps = BIDI_RANGE_STARTS.split(',');
  const classes = BIDI_RANGE_VALUES.split(',');
  const starts = new Int32Array(gaps.length);
  const values = new Uint8Array(classes.length);
  let start = 0;
  for (const [index, gap] of gaps.entries()) {
    start += Number.parseInt(gap, 36);
    starts[index] = start;
  }
  for (const [index, value] of classes.entries()) values[index] = Number.parseInt(value, 36);
  const bmp = new Uint8Array(BMP_SIZE);
  // Ranges past the BMP follow, so every BMP range has a next one.
  for (let range = 0; elementAt(starts, range) < BMP_SIZE; range += 1) {
    const next = Math.min(elementAt(starts, range + 1), BMP_SIZE);
    bmp.fill(elementAt(values, range), elementAt(starts, range), next);
  }
  return { starts, values, bmp };
}

/**
 * The index of a codepoint's Bidi_Class in `BIDI_CLASSES`.
 *
 * @param codepoint - The codepoint, 0 to 0x10FFFF.
 * @returns The index.
 */
export function bidiClassIndexOf(codepoint: number): number {
  table ??= decode();
  const { starts, values, bmp } = table;
  if (codepoint < BMP_SIZE) return elementAt(bmp, codepoint);
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
 * The Bidi_Class of a codepoint (UCD 17.0.0 DerivedBidiClass.txt, with its `@missing` defaults).
 *
 * @param codepoint - The codepoint.
 * @returns Its class, such as `L`, `R`, `AL` or `ON`.
 */
export function bidiClassOf(codepoint: number): BidiClass {
  return elementAt(BIDI_CLASSES, bidiClassIndexOf(codepoint));
}

/** A codepoint's paired bracket (UCD 17.0.0 BidiBrackets.txt). */
export interface PairedBracket {
  /** The codepoint of the bracket it pairs with. */
  readonly pair: number;
  /** Whether it opens (`o`) or closes (`c`) the pair. */
  readonly type: 'o' | 'c';
}

/**
 * A codepoint's paired bracket (UCD 17.0.0 BidiBrackets.txt).
 *
 * @param codepoint - The codepoint.
 * @returns Its pair and whether it opens or closes, or `undefined` for none.
 */
export function pairedBracketOf(codepoint: number): PairedBracket | undefined {
  if (brackets === undefined) {
    brackets = new Map();
    for (let at = 0; at + 2 < BIDI_BRACKETS.length + 1; at += 3) {
      const type = BIDI_BRACKETS[at + 2] === 0 ? 'o' : 'c';
      brackets.set(elementAt(BIDI_BRACKETS, at), { pair: elementAt(BIDI_BRACKETS, at + 1), type });
    }
  }
  return brackets.get(codepoint);
}

/**
 * A codepoint's mirrored glyph (UCD 17.0.0 BidiMirroring.txt), which a right-to-left run draws.
 *
 * @param codepoint - The codepoint.
 * @returns The mirror, or `undefined` for none.
 */
export function mirroredCodepointOf(codepoint: number): number | undefined {
  if (mirrors === undefined) {
    mirrors = new Map();
    for (let at = 0; at + 1 < BIDI_MIRRORS.length; at += 2) {
      mirrors.set(elementAt(BIDI_MIRRORS, at), elementAt(BIDI_MIRRORS, at + 1));
    }
  }
  return mirrors.get(codepoint);
}

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  lineBreakOpportunities as publicLineBreakOpportunities,
  lineBreakClassOf as publicLineBreakClassOf,
  LINE_BREAKING_VERSION,
  type LineBreakOpportunity,
  type LineBreakOptions,
} from '../index.js';

import { eastAsianWidthOf, lineBreakClassOf } from './line-break-class.js';
import { lineBreakOpportunities } from './line-breaks.js';

const UCD = '../unicode/__fixtures__/ucd-17.0.0/';

/**
 * Reads a checked-in Unicode 17 UCD file.
 *
 * @param name - UCD basename.
 * @returns Decompressed text.
 */
function ucdFile(name: string): string {
  return gunzipSync(readFileSync(new URL(`${UCD}${name}.txt.gz`, import.meta.url))).toString(
    'utf8',
  );
}

/**
 * Parses one LineBreakTest row into UTF-16 break offsets.
 *
 * @param row - A fixture row.
 * @returns Source text and legal offsets.
 */
function testCase(row: string): { text: string; indices: number[] } {
  const sequence = row.split('#', 1)[0]?.trim().split(/\s+/) ?? [];
  let text = '';
  const indices: number[] = [];
  for (let index = 0; index < sequence.length; index += 2) {
    const marker = sequence[index];
    if (marker === '÷' && text.length > 0) indices.push(text.length);
    const codepoint = sequence[index + 1];
    if (codepoint !== undefined) text += String.fromCodePoint(Number.parseInt(codepoint, 16));
  }
  return { text, indices };
}

interface PropertyRange {
  readonly first: number;
  readonly last: number;
  readonly value: string;
}

/**
 * Parses explicit UCD ranges; missing values are checked separately below.
 *
 * @param name - UCD basename.
 * @returns The explicit property ranges.
 */
function propertyRanges(name: string): PropertyRange[] {
  return ucdFile(name)
    .split(/\r?\n/)
    .flatMap((row) => {
      const match =
        /^(\p{ASCII_Hex_Digit}{4,6})(?:\.\.(\p{ASCII_Hex_Digit}{4,6}))?\s*;\s*(\w+)/u.exec(row);
      if (match === null) return [];
      const first = Number.parseInt(match[1] ?? '', 16);
      return [
        { first, last: Number.parseInt(match[2] ?? match[1] ?? '', 16), value: match[3] ?? '' },
      ];
    });
}

/**
 * Finds the UCD value at an explicitly listed codepoint.
 *
 * @param ranges - Explicit property ranges.
 * @param codepoint - Codepoint to find.
 * @returns The listed property, when present.
 */
function explicitValue(ranges: readonly PropertyRange[], codepoint: number): string | undefined {
  return ranges.find(({ first, last }) => first <= codepoint && codepoint <= last)?.value;
}

describe('Unicode 17 UAX #14 conformance', () => {
  it('exports the line-breaking contract from the package root', () => {
    const options: LineBreakOptions = { complexContext: 'none' };
    const opportunities: LineBreakOpportunity[] = publicLineBreakOpportunities('a', options);
    expect(opportunities).toEqual([{ index: 1, isMandatory: true }]);
    expect(publicLineBreakClassOf(0x61)).toBe('AL');
    expect(LINE_BREAKING_VERSION).toContain('17.0.0');
  });

  it('matches every LineBreakTest row at UTF-16 indices', () => {
    let count = 0;
    for (const [offset, row] of ucdFile('LineBreakTest').split(/\r?\n/).entries()) {
      if (!row.startsWith('÷') && !row.startsWith('×')) continue;
      count += 1;
      const { text, indices } = testCase(row);
      const comment = row.split('#', 2)[1]?.trim() ?? '';
      expect(
        lineBreakOpportunities(text, { complexContext: 'none' }).map(({ index }) => index),
        `LineBreakTest.txt line ${String(offset + 1)}: ${comment}`,
      ).toEqual(indices);
    }
    expect(count).toBeGreaterThan(10_000);
  });

  it('marks the end and breaks after BK, CR, LF, and NL mandatory, with CR LF indivisible', () => {
    for (const text of [
      'a\r\nb',
      'a\rb',
      'a\nb',
      'a\u0085b',
      'a\u2028b',
      'a\u2029b',
      'a\vb',
      'a\fb',
    ]) {
      const opportunities = lineBreakOpportunities(text);
      expect(opportunities.at(-1)).toEqual({ index: text.length, isMandatory: true });
      expect(
        opportunities.filter(({ isMandatory }) => isMandatory).map(({ index }) => index),
      ).toEqual([text.startsWith('a\r\n') ? 3 : 2, text.length]);
    }
    expect(lineBreakOpportunities('a b')).toEqual([
      { index: 2, isMandatory: false },
      { index: 3, isMandatory: true },
    ]);
  });

  it('reports UCD 17 property values across explicit ranges and @missing defaults', () => {
    const lineRanges = propertyRanges('LineBreak');
    const widthRanges = propertyRanges('EastAsianWidth');
    // Sample range endpoints and interiors across the full Unicode scalar range.
    for (const ranges of [lineRanges, widthRanges]) {
      const lookup = ranges === lineRanges ? lineBreakClassOf : eastAsianWidthOf;
      for (
        let index = 0;
        index < ranges.length;
        index += Math.max(1, Math.floor(ranges.length / 160))
      ) {
        const range = ranges[index];
        if (range === undefined) continue;
        for (const codepoint of new Set([
          range.first,
          Math.floor((range.first + range.last) / 2),
          range.last,
        ])) {
          expect(lookup(codepoint), `U+${codepoint.toString(16)}`).toBe(range.value);
        }
      }
    }
    // The UCD lists its CJK default ranges explicitly, including unassigned codepoints.
    for (const codepoint of [0x2fffd, 0x3fffd]) {
      expect(explicitValue(lineRanges, codepoint)).toBe('ID');
      expect(explicitValue(widthRanges, codepoint)).toBe('W');
      expect(lineBreakClassOf(codepoint)).toBe('ID');
      expect(eastAsianWidthOf(codepoint)).toBe('W');
    }
    for (const [codepoint, lineClass, width] of [
      [0x1ffff, 'XX', 'N'],
      [0x2fe0, 'XX', 'N'],
      [0x10ffff, 'XX', 'N'],
    ] as const) {
      expect(explicitValue(lineRanges, codepoint)).toBeUndefined();
      expect(explicitValue(widthRanges, codepoint)).toBeUndefined();
      expect(lineBreakClassOf(codepoint)).toBe(lineClass);
      expect(eastAsianWidthOf(codepoint)).toBe(width);
    }
  });
});

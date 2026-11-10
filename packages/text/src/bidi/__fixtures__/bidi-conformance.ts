/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import type { BidiClass } from '../bidi-class.js';

/** A class-based Unicode conformance row and its inherited expectations. */
export interface BidiClassCase {
  readonly line: number;
  readonly classes: BidiClass[];
  readonly directions: number;
  readonly levels: number[];
  readonly order: number[];
}

/** A codepoint-based Unicode conformance row. */
export interface BidiCharacterCase {
  readonly line: number;
  readonly codepoints: number[];
  readonly direction: number;
  readonly paragraphLevel: number;
  readonly levels: number[];
  readonly order: number[];
}

/**
 * Reads a checked-in Unicode 17 fixture.
 *
 * @param name - Fixture basename without its .txt.gz suffix.
 * @returns The decompressed UTF-8 file.
 */
export function ucdText(name: string): string {
  const url = new URL(`../../unicode/__fixtures__/ucd-17.0.0/${name}.txt.gz`, import.meta.url);
  return gunzipSync(readFileSync(url)).toString('utf8');
}

/**
 * Splits a whitespace-delimited fixture field, including an empty field.
 *
 * @param field - Text between semicolons or after a directive.
 * @returns Nonempty tokens in source order.
 */
export function tokens(field: string): string[] {
  const trimmed = field.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/u);
}

/**
 * Converts Unicode's x marker to the public removed-level sentinel.
 *
 * @param field - Whitespace-delimited level field.
 * @returns Levels in logical order.
 */
export function levelsOf(field: string): number[] {
  return tokens(field).map((value) => (value === 'x' ? 255 : Number(value)));
}

/**
 * Parses all class-based UBA cases, retaining directive state and source line numbers.
 *
 * @returns Every BidiTest data row.
 */
export function bidiClassCases(): BidiClassCase[] {
  const cases: BidiClassCase[] = [];
  let levels: number[] = [];
  let order: number[] = [];
  for (const [index, source] of ucdText('BidiTest').split(/\r?\n/u).entries()) {
    const row = source.split('#', 1)[0]?.trim() ?? '';
    if (row.startsWith('@Levels:')) {
      levels = levelsOf(row.slice('@Levels:'.length));
    } else if (row.startsWith('@Reorder:')) {
      order = tokens(row.slice('@Reorder:'.length)).map(Number);
    } else if (/^[^@]/u.test(row)) {
      const [classField = '', directionField = ''] = row.split(';');
      cases.push({
        line: index + 1,
        classes: tokens(classField) as BidiClass[],
        directions: Number.parseInt(directionField.trim(), 16),
        levels,
        order,
      });
    }
  }
  return cases;
}

/**
 * Parses all codepoint-based UBA cases with their source line numbers.
 *
 * @returns Every BidiCharacterTest data row.
 */
export function bidiCharacterCases(): BidiCharacterCase[] {
  const cases: BidiCharacterCase[] = [];
  for (const [index, source] of ucdText('BidiCharacterTest').split(/\r?\n/u).entries()) {
    const row = source.split('#', 1)[0]?.trim() ?? '';
    if (row.length === 0) continue;
    const [
      codepointField = '',
      directionField = '',
      paragraphField = '',
      levelField = '',
      orderField = '',
    ] = row.split(';');
    cases.push({
      line: index + 1,
      codepoints: tokens(codepointField).map((value) => Number.parseInt(value, 16)),
      direction: Number(directionField),
      paragraphLevel: Number(paragraphField),
      levels: levelsOf(levelField),
      order: tokens(orderField).map(Number),
    });
  }
  return cases;
}

/**
 * Throws one bounded report after every fixture case has been checked.
 *
 * @param failures - Human-readable failures containing fixture line numbers.
 * @param checked - Number of tested cases.
 * @param fixture - Fixture basename for the report.
 * @throws {Error} When at least one fixture case failed.
 */
export function reportFailures(
  failures: readonly string[],
  checked: number,
  fixture: string,
): void {
  if (failures.length > 0) {
    throw new Error(
      `${fixture}: ${String(failures.length)} failures in ${String(checked)} cases\n${failures.slice(0, 25).join('\n')}`,
    );
  }
}

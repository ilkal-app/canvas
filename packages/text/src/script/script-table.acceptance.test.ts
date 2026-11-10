/// <reference types="node" />
// The script table against the pinned UCD 17 files (script-table.test.ts generates it).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { SCRIPT_CODES, scriptExtensionsOf, scriptOf } from '@canvas/text';

const UCD = new URL('../unicode/__fixtures__/ucd-17.0.0/', import.meta.url);
const MAX_CODEPOINT = 0x10ffff;

/**
 * Reads noncomment UCD records, preserving their semicolon fields.
 *
 * @param name - The UCD filename.
 * @returns Its parsed records.
 */
function records(name: string): string[][] {
  return gunzipSync(readFileSync(new URL(`${name}.gz`, UCD)))
    .toString('utf8')
    .split('\n')
    .map((line) => line.replace(/#.*/u, '').trim())
    .filter(Boolean)
    .map((line) => line.split(';').map((part) => part.trim()));
}

/**
 * Expands a UCD scalar or inclusive scalar range.
 *
 * @param field - The scalar or range field.
 * @returns Inclusive range bounds.
 */
function bounds(field: string): readonly [number, number] {
  const [first = '', last = first] = field.split('..');
  return [Number.parseInt(first, 16), Number.parseInt(last, 16)];
}

const aliases = records('PropertyValueAliases.txt')
  .filter(([property]) => property === 'sc')
  .map(([, short]) => short ?? '');
const longToShort = new Map(
  records('PropertyValueAliases.txt')
    .filter(([property]) => property === 'sc')
    .map(([, short, long]) => [long, short] as const),
);
const scripts = records('Scripts.txt')
  .map(([range = '', name = '']) => {
    const short = longToShort.get(name);
    if (short === undefined) throw new Error(`Unknown Script property: ${name}`);
    return [...bounds(range), short] as const;
  })
  .sort(([first], [second]) => first - second);
const extensions = records('ScriptExtensions.txt')
  .map(([range = '', names = '']) => {
    const codes = names.split(/\s+/u);
    for (const code of codes)
      if (!aliases.includes(code)) throw new Error(`Unknown script: ${code}`);
    return [...bounds(range), codes] as const;
  })
  .sort(([first], [second]) => first - second);

describe('UCD 17 script table', () => {
  it('contains exactly every Script ISO 15924 short name, including Common, Inherited and Unknown', () => {
    expect(new Set(SCRIPT_CODES)).toEqual(new Set(aliases));
    expect(SCRIPT_CODES).toEqual(expect.arrayContaining(['Zyyy', 'Zinh', 'Zzzz']));
    expect(SCRIPT_CODES.length).toBe(new Set(SCRIPT_CODES).size);
  });

  it('matches both UCD properties at every codepoint from U+0000 through U+10FFFF', () => {
    let scriptIndex = 0;
    let extensionIndex = 0;
    let checked = 0;
    for (let point = 0; point <= MAX_CODEPOINT; point += 1) {
      while ((scripts[scriptIndex]?.[1] ?? -1) < point && scriptIndex < scripts.length) {
        scriptIndex += 1;
      }
      while (
        (extensions[extensionIndex]?.[1] ?? -1) < point &&
        extensionIndex < extensions.length
      ) {
        extensionIndex += 1;
      }
      const scriptRange = scripts[scriptIndex];
      const expectedScript =
        scriptRange !== undefined && scriptRange[0] <= point ? scriptRange[2] : 'Zzzz';
      const extensionRange = extensions[extensionIndex];
      const expectedExtensions =
        extensionRange !== undefined && extensionRange[0] <= point
          ? extensionRange[2]
          : [expectedScript];
      const actualScript = scriptOf(point);
      if (actualScript !== expectedScript) {
        expect(actualScript, `Script at U+${point.toString(16)}`).toBe(expectedScript);
      }
      const actualExtensions = scriptExtensionsOf(point);
      if (
        actualExtensions.length !== expectedExtensions.length ||
        actualExtensions.some((code, index) => code !== expectedExtensions[index])
      ) {
        expect(actualExtensions, `Script_Extensions at U+${point.toString(16)}`).toEqual(
          expectedExtensions,
        );
      }
      checked += 1;
    }
    expect(checked).toBe(0x110000);
  }, 30_000);
});

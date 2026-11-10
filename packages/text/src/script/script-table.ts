// The Script and Script_Extensions properties of Unicode 17.0.0, by codepoint, from the
// table `script-table.test.ts` generates from the UCD (`script-data.ts`). Scripts are named by
// their ISO 15924 short names: `Latn`, `Hani`, and `Zyyy` (Common), `Zinh` (Inherited) and `Zzzz`
// (Unknown).

import { elementAt } from '../line-break/element-at.js';

import {
  SCRIPT_CODE_LIST,
  SCRIPT_EXTENSIONS,
  SCRIPT_RANGE_STARTS,
  SCRIPT_RANGE_VALUES,
} from './script-data.js';

/** A Script property value: its ISO 15924 short name, such as `Latn`, `Hani` or `Zyyy`. */
export type ScriptCode = string;

/** Every Script value of Unicode 17.0.0, ISO 15924 short names. */
export const SCRIPT_CODES: readonly ScriptCode[] = Object.freeze(SCRIPT_CODE_LIST.split(','));

/** One Script_Extensions entry: an inclusive codepoint range and its scripts. */
interface ExtensionRange {
  /** Its first codepoint. */
  readonly first: number;
  /** Its last codepoint. */
  readonly last: number;
  /** Its scripts. */
  readonly scripts: readonly ScriptCode[];
}

/** The decoded table. */
interface ScriptTable {
  /** Each range's first codepoint, ascending, the first 0. */
  readonly starts: Int32Array;
  /** Each range's Script, an index into `SCRIPT_CODES`. */
  readonly values: Uint8Array;
  /** The Script_Extensions entries, ascending. */
  readonly extensions: readonly ExtensionRange[];
}

let table: ScriptTable | undefined;

/**
 * Decodes the generated table.
 *
 * @returns The table.
 */
function decode(): ScriptTable {
  const gaps = SCRIPT_RANGE_STARTS.split(',');
  const starts = new Int32Array(gaps.length);
  let start = 0;
  for (const [index, gap] of gaps.entries()) {
    start += Number.parseInt(gap, 36);
    starts[index] = start;
  }
  const values = Uint8Array.from(SCRIPT_RANGE_VALUES.split(','), (value) =>
    Number.parseInt(value, 36),
  );
  const extensions = SCRIPT_EXTENSIONS.split(',').map((entry): ExtensionRange => {
    const [range = '', indices = ''] = entry.split(':');
    const [first = '', last = ''] = range.split('-');
    return {
      first: Number.parseInt(first, 36),
      last: Number.parseInt(last, 36),
      scripts: indices
        .split(' ')
        .map((index) => elementAt(SCRIPT_CODES, Number.parseInt(index, 36))),
    };
  });
  return { starts, values, extensions };
}

/**
 * The decoded table, decoded on first use.
 *
 * @returns The table.
 */
function scriptTable(): ScriptTable {
  table ??= decode();
  return table;
}

/**
 * A codepoint's Script property (UCD 17.0.0 Scripts.txt; unlisted codepoints are `Zzzz`).
 *
 * @param codepoint - The codepoint, 0 to 0x10FFFF.
 * @returns Its script's ISO 15924 short name.
 */
export function scriptOf(codepoint: number): ScriptCode {
  const { starts, values } = scriptTable();
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (elementAt(starts, middle) <= codepoint) low = middle;
    else high = middle - 1;
  }
  return elementAt(SCRIPT_CODES, elementAt(values, low));
}

/**
 * A codepoint's Script_Extensions property (UCD 17.0.0 ScriptExtensions.txt): the scripts it is
 * used with; a codepoint not listed has just its own Script.
 *
 * @param codepoint - The codepoint, 0 to 0x10FFFF.
 * @returns Its scripts, ISO 15924 short names.
 */
export function scriptExtensionsOf(codepoint: number): readonly ScriptCode[] {
  const { extensions } = scriptTable();
  let low = 0;
  let high = extensions.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const entry = elementAt(extensions, middle);
    if (codepoint < entry.first) high = middle - 1;
    else if (codepoint > entry.last) low = middle + 1;
    else return entry.scripts;
  }
  return [scriptOf(codepoint)];
}

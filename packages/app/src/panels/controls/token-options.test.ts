import { describe, expect, it } from 'vitest';

import { BUILTIN_TOKEN_DEFAULTS, type TokenEntry, type TokenTable } from '@canvas/schema';

import { nextTokenName, tokenNameOf, tokenOptionsOf, UNKNOWN_TOKEN_NAME } from './token-options.js';

/**
 * A custom token's entry.
 *
 * @param id - Its id.
 * @param name - Its name.
 * @returns The entry.
 */
function custom(id: string, name: string): TokenEntry {
  return {
    id,
    name,
    light: [1, 0, 0, 1],
    dark: [0, 0, 1, 1],
    builtin: false,
    createdBy: null,
    createdAt: 0,
  };
}

const EDITED_ACCENT: TokenEntry = {
  id: 'accent',
  name: 'accent',
  light: [0, 1, 0, 1],
  dark: [0, 0.5, 0, 1],
  builtin: true,
  createdBy: null,
  createdAt: 0,
};

describe('tokenOptionsOf', () => {
  it('lists the six built-ins at their defaults on a board without tokens', () => {
    const options = tokenOptionsOf(new Map());
    expect(options.map((option) => option.id)).toEqual([
      'ink',
      'text',
      'muted',
      'surface',
      'border',
      'accent',
    ]);
    expect(options[5]).toEqual({
      id: 'accent',
      name: 'accent',
      values: BUILTIN_TOKEN_DEFAULTS.accent,
      isBuiltin: true,
      isEdited: false,
    });
  });

  it('gives an edited built-in its values, then the custom tokens by name', () => {
    const table: TokenTable = new Map([
      ['accent', EDITED_ACCENT],
      ['b', custom('b', 'brand')],
      ['a', custom('a', 'Zest')],
      ['c', custom('c', 'apple')],
    ]);
    const options = tokenOptionsOf(table);
    expect(options[5]).toMatchObject({ values: EDITED_ACCENT, isEdited: true });
    expect(options.slice(6).map((option) => option.name)).toEqual(['apple', 'brand', 'Zest']);
    expect(options.slice(6).every((option) => !option.isBuiltin)).toBe(true);
  });
});

describe('tokenNameOf and nextTokenName', () => {
  it('names a built-in by its id, a custom token by its name, else unknown', () => {
    const table: TokenTable = new Map([['b', custom('b', 'brand')]]);
    expect(tokenNameOf('muted', table)).toBe('muted');
    expect(tokenNameOf('b', table)).toBe('brand');
    expect(tokenNameOf('gone', table)).toBe(UNKNOWN_TOKEN_NAME);
  });

  it('picks the first free "Colour n", case-blind', () => {
    expect(nextTokenName(new Map())).toBe('Colour 1');
    const table: TokenTable = new Map([
      ['a', custom('a', 'colour 1')],
      ['b', custom('b', 'Colour 2')],
    ]);
    expect(nextTokenName(table)).toBe('Colour 3');
  });
});

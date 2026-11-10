import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { BUILTIN_TOKEN_DEFAULTS, INK_COLORS, type PrincipalId } from '@canvas/schema';

import { parseTokenKey, readTokens, tokenKey, TOKENS_MAP_NAME } from './token-map.js';
import { eraseToken, writeToken } from './token-writes.js';

const ADA = { createdBy: 'user:ada' as PrincipalId, createdAt: 5 };

/**
 * A fresh tokens map in its own document.
 *
 * @returns The map.
 */
function tokensMap(): Y.Map<unknown> {
  return new Y.Doc().getMap(TOKENS_MAP_NAME);
}

describe('the tokens map', () => {
  it('splits keys of token fields and refuses others', () => {
    expect(parseTokenKey(tokenKey('brand', 'light'))).toEqual({ tokenId: 'brand', field: 'light' });
    expect(parseTokenKey('brand')).toBeUndefined();
    expect(parseTokenKey('brand.colour')).toBeUndefined();
    expect(parseTokenKey('bad id.name')).toBeUndefined();
  });

  it('writes a custom token and an edited built-in, and reads them sorted by id', () => {
    const map = tokensMap();
    writeToken(map, { id: 'zeta', name: 'Zeta', light: [1, 0, 0, 1], dark: [0, 0, 1, 1] }, ADA);
    writeToken(
      map,
      { id: 'accent', name: 'ignored', light: [0, 1, 0, 1], dark: [0, 1, 0, 1] },
      ADA,
    );
    expect(map.has(tokenKey('accent', 'name'))).toBe(false);
    const tokens = readTokens(map);
    expect([...tokens.keys()]).toEqual(['accent', 'zeta']);
    expect(tokens.get('accent')).toMatchObject({
      name: 'accent',
      builtin: true,
      createdBy: 'user:ada',
    });
    expect(tokens.get('zeta')).toMatchObject({ name: 'Zeta', builtin: false, createdAt: 5 });
    expect(eraseToken(map, 'zeta')).toBe(true);
    expect(eraseToken(map, 'zeta')).toBe(false);
    expect(readTokens(map).has('zeta')).toBe(false);
  });

  it('ignores keys without an identity and falls back for unreadable values', () => {
    const map = tokensMap();
    map.set(tokenKey('orphan', 'light'), [1, 0, 0, 1]);
    map.set(tokenKey('muted', 'identity'), { builtin: true, createdBy: null, createdAt: 0 });
    map.set(tokenKey('muted', 'dark'), 'not a colour');
    map.set(tokenKey('odd', 'identity'), { builtin: false, createdBy: null, createdAt: 0 });
    map.set(tokenKey('odd', 'name'), 42);
    map.set(tokenKey('fake', 'identity'), { builtin: true, createdBy: null, createdAt: 0 });
    const tokens = readTokens(map);
    expect([...tokens.keys()]).toEqual(['muted', 'odd']);
    expect(tokens.get('muted')?.dark).toBe(BUILTIN_TOKEN_DEFAULTS.muted.dark);
    expect(tokens.get('odd')).toMatchObject({ name: 'odd', light: INK_COLORS.light });
  });

  it('writes only the keys that change', () => {
    const map = tokensMap();
    const token = {
      id: 'brand',
      name: 'Brand',
      light: [1, 0, 0, 1] as const,
      dark: [0, 0, 1, 1] as const,
    };
    writeToken(map, { ...token, light: [...token.light], dark: [...token.dark] }, ADA);
    let writes = 0;
    map.observe((event) => (writes += event.keysChanged.size));
    writeToken(map, { ...token, light: [0, 1, 0, 1], dark: [...token.dark] }, ADA);
    expect(writes).toBe(1);
  });
});

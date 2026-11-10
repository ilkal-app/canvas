import { describe, expect, it } from 'vitest';

import { findCommonEnds } from './text-diff.js';

describe('findCommonEnds', () => {
  it('measures the shared prefix and suffix of an edit', () => {
    expect(findCommonEnds('Launch plan v2', 'Launch plan v3')).toEqual({ prefix: 13, suffix: 0 });
    expect(findCommonEnds('abc', 'aXbc')).toEqual({ prefix: 1, suffix: 2 });
    expect(findCommonEnds('same', 'same')).toEqual({ prefix: 4, suffix: 0 });
    expect(findCommonEnds('', 'new')).toEqual({ prefix: 0, suffix: 0 });
  });

  it('never lets the prefix or suffix end inside a surrogate pair', () => {
    // 😀 is D83D DE00 and 😁 is D83D DE01: they share a high surrogate.
    expect(findCommonEnds('a😀b', 'a😁b')).toEqual({ prefix: 1, suffix: 1 });
    // 𐐀 (D801 DC00) and 𑐀 (D805 DC00) share a low surrogate.
    expect(findCommonEnds('x𐐀', 'x𑐀')).toEqual({ prefix: 1, suffix: 0 });
  });
});

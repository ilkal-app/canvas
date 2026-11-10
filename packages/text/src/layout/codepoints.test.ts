import { describe, expect, it } from 'vitest';

import { codepointAt } from './codepoints.js';

describe('codepointAt', () => {
  it('reads a BMP character as one code unit', () => {
    expect(codepointAt('aé', 1)).toEqual({ codepoint: 0xe9, length: 1 });
  });

  it('decodes a surrogate pair as one codepoint of two code units', () => {
    expect(codepointAt('a\u{1F600}', 1)).toEqual({ codepoint: 0x1f600, length: 2 });
  });

  it('returns a lone high or low surrogate as itself', () => {
    expect(codepointAt('\uD83D', 0)).toEqual({ codepoint: 0xd83d, length: 1 });
    expect(codepointAt('\uD83Da', 0)).toEqual({ codepoint: 0xd83d, length: 1 });
    expect(codepointAt('\uDE00', 0)).toEqual({ codepoint: 0xde00, length: 1 });
  });
});

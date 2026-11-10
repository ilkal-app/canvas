import { describe, expect, it } from 'vitest';

import { nextCharacterIndex, previousCharacterIndex } from './character-steps.js';
import { wordEndAfter, wordRangeAt, wordStartBefore } from './word-ranges.js';

describe('word and character steps at the text’s edges', () => {
  it('stops a word step at the start or end of text with no word to cross', () => {
    expect(wordStartBefore('  ', 2)).toBe(0);
    expect(wordStartBefore('ab', 2)).toBe(0);
    expect(wordEndAfter('ab  ', 2)).toBe(4);
    expect(wordEndAfter('ab', 0)).toBe(2);
  });

  it('steps one code unit near the edges, and a surrogate pair whole', () => {
    expect(previousCharacterIndex('ab', 1)).toBe(0);
    expect(previousCharacterIndex('a😀', 3)).toBe(1);
    expect(nextCharacterIndex('ab', 1)).toBe(2);
    expect(nextCharacterIndex('😀b', 0)).toBe(2);
  });
});

describe('locale-aware word edges', () => {
  it('selects a newline alone, and reads words with an unknown locale as the default', () => {
    expect(wordRangeAt('ab\ncd', 2)).toEqual([2, 3]);
    expect(wordRangeAt('สวัสดีครับ', 7, 'not a tag')).toEqual([6, 10]);
  });

  it('finds words by character class where Intl.Segmenter is missing', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Reflect.deleteProperty(Intl, 'Segmenter');
    try {
      expect(wordStartBefore('ab e\u0301', 4)).toBe(3);
      expect(wordRangeAt('ab  cd', 2)).toEqual([2, 4]);
      expect(wordStartBefore('  ', 2)).toBe(0);
      expect(wordEndAfter('ab  ', 2)).toBe(4);
    } finally {
      if (descriptor !== undefined) Object.defineProperty(Intl, 'Segmenter', descriptor);
    }
  });
});

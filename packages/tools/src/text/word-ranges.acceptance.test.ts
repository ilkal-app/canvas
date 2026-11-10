import { describe, expect, it } from 'vitest';

import { wordEndAfter, wordRangeAt, wordStartBefore } from './word-ranges.js';

describe('locale-aware word ranges', () => {
  it('finds both Thai words without spaces and advances to their boundary', () => {
    const text = 'สวัสดีครับ';
    expect(wordRangeAt(text, 2, 'th')).toEqual([0, 6]);
    expect(wordRangeAt(text, 7, 'th')).toEqual([6, 10]);
    expect(wordEndAfter(text, 0, 'th')).toBe(6);
    expect(wordStartBefore(text, 10, 'th')).toBe(6);
  });

  it('finds a Chinese word within an unspaced sentence', () => {
    expect(wordRangeAt('我喜欢吃苹果', 2, 'zh')).toEqual([1, 3]);
  });

  it('keeps Devanagari vowel signs and viramas within words', () => {
    const text = 'नमस्ते दुनिया';
    expect(wordRangeAt(text, 2, 'hi')).toEqual([0, 6]);
    expect(wordEndAfter(text, 0, 'hi')).toBe(6);
    expect(wordStartBefore(text, text.length, 'hi')).toBe(7);
  });

  it('selects adjacent non-word characters as one run without crossing a newline', () => {
    expect(wordRangeAt('one,  !two', 4, 'en')).toEqual([3, 7]);
    expect(wordRangeAt('one?!\n  two', 4, 'en')).toEqual([3, 5]);
    expect(wordRangeAt('one?!\n  two', 6, 'en')).toEqual([6, 8]);
  });

  it('keeps combining marks in words when Intl.Segmenter is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Reflect.deleteProperty(Intl, 'Segmenter');
    try {
      expect(wordRangeAt('e\u0301!', 1, 'en')).toEqual([0, 2]);
      expect(wordEndAfter('e\u0301!', 0, 'en')).toBe(2);
    } finally {
      if (descriptor !== undefined) Object.defineProperty(Intl, 'Segmenter', descriptor);
    }
  });

  it('returns grapheme boundaries when probed inside a combining sequence', () => {
    expect(wordRangeAt('e\u0301 next', 1, 'en')).toEqual([0, 2]);
  });
});

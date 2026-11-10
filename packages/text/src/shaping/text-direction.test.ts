import { describe, expect, it } from 'vitest';

import { anyScript, guessDirection } from './text-direction.js';

describe('guessDirection', () => {
  it('takes the direction of the first character with a script of its own', () => {
    expect(guessDirection('hello', 0, 5)).toBe('ltr');
    expect(guessDirection('مرحبا', 0, 5)).toBe('rtl');
    expect(guessDirection('שלום', 0, 4)).toBe('rtl');
    // Digits, spaces and punctuation are Common: the Arabic after them decides.
    expect(guessDirection('12, مرحبا', 0, 9)).toBe('rtl');
    expect(guessDirection('12, abc مرحبا', 0, 13)).toBe('ltr');
  });

  it('reads only the stretch, steps over surrogate pairs and defaults to left to right', () => {
    expect(guessDirection('abc مرحبا', 4, 9)).toBe('rtl');
    // Adlam (U+1E900, a surrogate pair) is written right to left.
    expect(guessDirection('\u{1F600}\u{1E900}', 0, 4)).toBe('rtl');
    expect(guessDirection('123 !?', 0, 6)).toBe('ltr');
    expect(guessDirection('', 0, 0)).toBe('ltr');
  });

  it('gives left to right for a script written either way, as HarfBuzz does', () => {
    // Old Italic (U+10300) is one of the four scripts HarfBuzz leaves without a direction.
    expect(guessDirection('\u{10300}', 0, 2)).toBe('ltr');
  });
});

describe('anyScript', () => {
  it('leaves out a script the runtime does not know', () => {
    const pattern = anyScript(['Arabic', 'Not_A_Script']);
    expect(pattern.test('م')).toBe(true);
    expect(pattern.test('a')).toBe(false);
  });
});

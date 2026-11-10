import { describe, expect, it } from 'vitest';

import {
  BASE_62_DIGITS,
  isValidKey,
  isWellFormedKey,
  keyIntegerLength,
  MAX_KEY_LENGTH,
  SMALLEST_KEY_INTEGER,
} from './key-rule.js';

const LARGEST_INTEGER = `z${'z'.repeat(26)}`;

describe('BASE_62_DIGITS', () => {
  it('lists the 62 digits in ascending code-unit order, so string order is numeric order', () => {
    expect(BASE_62_DIGITS).toHaveLength(62);
    for (let index = 1; index < BASE_62_DIGITS.length; index += 1) {
      expect(BASE_62_DIGITS.charCodeAt(index)).toBeGreaterThan(
        BASE_62_DIGITS.charCodeAt(index - 1),
      );
    }
  });
});

describe('keyIntegerLength', () => {
  it.each([
    ['a', 2],
    ['b', 3],
    ['z', 27],
    ['Z', 2],
    ['Y', 3],
    ['A', 27],
  ])('gives head %s an integer part of %i characters', (head, length) => {
    expect(keyIntegerLength(head)).toBe(length);
  });

  it('has no length for a head that is not a letter', () => {
    expect(keyIntegerLength('0')).toBeUndefined();
    expect(keyIntegerLength('-')).toBeUndefined();
  });
});

describe('isValidKey', () => {
  it.each(['a0', 'Zz', 'a0V', 'b00', 'Xzzz', `${SMALLEST_KEY_INTEGER}1`, LARGEST_INTEGER])(
    'accepts %s',
    (key) => {
      expect(isValidKey(key)).toBe(true);
    },
  );

  it.each([
    ['empty', ''],
    ['an integer part that is too short', 'a'],
    ['a head that states more digits than follow', 'legacy'],
    ['a head that is not a letter', '0a'],
    ['a trailing zero in the fraction', 'a0V0'],
    ['a character outside base 62', 'a0-'],
    ['a non-ASCII character', 'a0é'],
    ['the smallest integer, which has nothing below it', SMALLEST_KEY_INTEGER],
  ])('rejects %s', (label, key) => {
    expect(isValidKey(key), label).toBe(false);
  });

  it(`accepts keys up to ${String(MAX_KEY_LENGTH)} characters and rejects longer ones`, () => {
    expect(MAX_KEY_LENGTH).toBe(512);
    expect(isValidKey(`a0${'V'.repeat(MAX_KEY_LENGTH - 2)}`)).toBe(true);
    expect(isValidKey(`a0${'V'.repeat(MAX_KEY_LENGTH - 1)}`)).toBe(false);
  });
});

describe('isWellFormedKey', () => {
  it('applies the same rule as isValidKey except the length cap', () => {
    const long = `a0${'V'.repeat(MAX_KEY_LENGTH)}`;
    expect(isWellFormedKey(long)).toBe(true);
    expect(isValidKey(long)).toBe(false);
    expect(isWellFormedKey(`${long}0`)).toBe(false);
    expect(isWellFormedKey('a')).toBe(false);
  });
});

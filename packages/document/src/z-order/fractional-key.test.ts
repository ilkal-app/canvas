import { describe, expect, it } from 'vitest';

import { compareKeys, isValidKey } from '@canvas/schema';

import { generateKeyBetween, generateNKeysBetween } from './fractional-key.js';

const SMALLEST_INTEGER = `A${'0'.repeat(26)}`;

/**
 * Time allowed for a 10k-insert worst-case growth test: its keys reach 2,000 characters, which
 * takes about half a second alone but several under the full suite's coverage instrumentation.
 */
const GROWTH_TIMEOUT_MS = 30_000;
const LARGEST_INTEGER = `z${'z'.repeat(26)}`;

/**
 * Asserts that keys are valid, strictly increasing and inside the open interval (lower, upper).
 *
 * @param keys - The keys, bottom to top.
 * @param lower - The exclusive lower bound, or null.
 * @param upper - The exclusive upper bound, or null.
 */
function expectOrderedBetween(
  keys: readonly string[],
  lower: string | null,
  upper: string | null,
): void {
  for (const key of keys) expect(isValidKey(key), key).toBe(true);
  const bounded = [...(lower === null ? [] : [lower]), ...keys, ...(upper === null ? [] : [upper])];
  for (let index = 1; index < bounded.length; index += 1) {
    expect(compareKeys(bounded[index - 1] ?? '', bounded[index] ?? '')).toBeLessThan(0);
  }
}

describe('generateKeyBetween', () => {
  it.each([
    [null, null, 'a0'],
    [null, 'a0', 'Zz'],
    [null, 'Zz', 'Zy'],
    ['a0', null, 'a1'],
    ['a1', null, 'a2'],
    ['a0', 'a1', 'a0V'],
    ['a1', 'a2', 'a1V'],
    ['a0V', 'a1', 'a0l'],
    ['Zz', 'a0', 'ZzV'],
    ['Zz', 'a1', 'a0'],
    [null, 'Y00', 'Xzzz'],
    ['bzz', null, 'c000'],
    ['a0', 'a0V', 'a0G'],
    ['a0', 'a0G', 'a08'],
    ['b125', 'b129', 'b127'],
    ['a0', 'a1V', 'a0V'],
    ['Zz', 'a01', 'ZzV'],
    [null, 'a0V', 'Zz'],
    ['a0', 'a01V', 'a00V'],
  ] as const)('between %s and %s is %s', (lower, upper, expected) => {
    expect(generateKeyBetween(lower, upper)).toBe(expected);
  });

  it('places a key below the smallest integer inside its fraction', () => {
    expect(generateKeyBetween(null, `${SMALLEST_INTEGER}V`)).toBe(`${SMALLEST_INTEGER}G`);
  });

  it('never returns the smallest integer alone, which is not a key', () => {
    const justAbove = `A${'0'.repeat(25)}1`;
    for (const upper of [justAbove, `${justAbove}V`]) {
      const key = generateKeyBetween(null, upper);
      expect(key).toBe(`${SMALLEST_INTEGER}V`);
      expect(isValidKey(key)).toBe(true);
    }
  });

  it('places a key above the largest integer inside its fraction', () => {
    expect(generateKeyBetween(LARGEST_INTEGER, null)).toBe(`${LARGEST_INTEGER}V`);
    expect(generateKeyBetween(`${LARGEST_INTEGER}zz`, null)).toBe(`${LARGEST_INTEGER}zzV`);
  });

  it('crosses integer lengths when incrementing and decrementing', () => {
    expect(generateKeyBetween('Zz', null)).toBe('a0');
    expect(generateKeyBetween('az', null)).toBe('b00');
    expect(generateKeyBetween('Yzz', null)).toBe('Z0');
    expect(generateKeyBetween(null, 'a0')).toBe('Zz');
    expect(generateKeyBetween(null, 'Z0')).toBe('Yzz');
    expect(generateKeyBetween(null, 'b00')).toBe('az');
  });

  it('never returns a prefix of the upper bound, so a suffix keeps the key below it', () => {
    const pairs: [string | null, string][] = [
      ['a0', 'a1V'],
      [null, 'a0V'],
      ['a0', 'a01V'],
      ['Zz', 'a01'],
      ['a0', 'a0V'],
      ['a0V', 'a0VV'],
      [null, `${SMALLEST_INTEGER}01`],
    ];
    for (const [lower, upper] of pairs) {
      const key = generateKeyBetween(lower, upper);
      expect(upper.startsWith(key), `${key} is a prefix of ${upper}`).toBe(false);
      expect(compareKeys(`${key}zzzz`, upper)).toBeLessThan(0);
    }
  });

  it('refuses invalid or unordered bounds', () => {
    expect(() => generateKeyBetween('a0', 'a0')).toThrow(RangeError);
    expect(() => generateKeyBetween('a1', 'a0')).toThrow(RangeError);
    expect(() => generateKeyBetween('a00', null)).toThrow(RangeError);
    expect(() => generateKeyBetween(null, 'a')).toThrow(RangeError);
    expect(() => generateKeyBetween(SMALLEST_INTEGER, null)).toThrow(RangeError);
  });
});

describe('generateNKeysBetween', () => {
  it('returns nothing for zero keys and one key for one', () => {
    expect(generateNKeysBetween('a0', 'a1', 0)).toEqual([]);
    expect(generateNKeysBetween('a0', 'a1', 1)).toEqual(['a0V']);
  });

  it('counts integers up from the top and down from the bottom', () => {
    expect(generateNKeysBetween(null, null, 5)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4']);
    expect(generateNKeysBetween('a4', null, 3)).toEqual(['a5', 'a6', 'a7']);
    expect(generateNKeysBetween(null, 'a0', 5)).toEqual(['Zv', 'Zw', 'Zx', 'Zy', 'Zz']);
  });

  it('spreads keys between two neighbours in order', () => {
    const keys = generateNKeysBetween('a0', 'a2', 20);
    expect(keys).toHaveLength(20);
    expectOrderedBetween(keys, 'a0', 'a2');
    expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(3);
  });

  it('refuses a negative or fractional count', () => {
    expect(() => generateNKeysBetween(null, null, -1)).toThrow(RangeError);
    expect(() => generateNKeysBetween(null, null, 1.5)).toThrow(RangeError);
  });
});

describe('boundary keys', () => {
  it('always finds a key in front of everything and behind everything', () => {
    const keys = generateNKeysBetween(null, null, 50);
    const front = generateKeyBetween(keys.at(-1) ?? null, null);
    const back = generateKeyBetween(null, keys[0] ?? null);
    expectOrderedBetween([back, ...keys, front], null, null);
  });

  it('keeps 10k keys at the front short: the integer part grows logarithmically', () => {
    let key = generateKeyBetween(null, null);
    for (let count = 1; count < 10_000; count += 1) key = generateKeyBetween(key, null);
    // 'a' holds 62 integers, 'b' 62², 'c' 62³: the 10,000th is a four-character integer.
    expect(key).toHaveLength(4);
  });

  it('keeps 10k keys at the back short', () => {
    let key = generateKeyBetween(null, null);
    for (let count = 1; count < 10_000; count += 1) key = generateKeyBetween(null, key);
    expect(key).toHaveLength(4);
  });
});

describe('key length growth at one interior position', () => {
  // Worst case: every insert lands next to the previous one, against one fixed neighbour. The
  // midpoint digit then walks a fixed cycle before the key needs another character: upward to
  // the ceiling 31, 47, 55, 59, 61 (five inserts; Math.round takes .5 up), downward to zero 31,
  // 16, 8, 4, 2, 1 (six). So n inserts add at most ceil(n / 5) or ceil(n / 6) characters to
  // the two-character integer part.

  it(
    'grows one character per six inserts that always land just above one fixed neighbour',
    () => {
      const lower = 'a0';
      let upper = 'a1';
      for (let count = 0; count < 10_000; count += 1) upper = generateKeyBetween(lower, upper);
      expect(upper.length).toBeLessThanOrEqual(2 + Math.ceil(10_000 / 6));
    },
    GROWTH_TIMEOUT_MS,
  );

  it(
    'grows one character per five inserts that always land just below one fixed neighbour',
    () => {
      let lower = 'a0';
      const upper = 'a1';
      for (let count = 0; count < 10_000; count += 1) lower = generateKeyBetween(lower, upper);
      expect(lower.length).toBeLessThanOrEqual(2 + Math.ceil(10_000 / 5));
    },
    GROWTH_TIMEOUT_MS,
  );

  it('stays short when 10k inserts land at random positions', () => {
    let state = 7;
    const random = (): number => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    const keys: string[] = [];
    for (let count = 0; count < 10_000; count += 1) {
      const at = Math.floor(random() * (keys.length + 1));
      keys.splice(at, 0, generateKeyBetween(keys[at - 1] ?? null, keys[at] ?? null));
    }
    expectOrderedBetween(keys, null, null);
    expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(16);
  });
});

import { describe, expect, it } from 'vitest';

import {
  compareKeys,
  createSeededIdGenerator,
  isValidKey,
  MAX_KEY_LENGTH,
  type ObjectId,
} from '@canvas/schema';

import { generateKeyBetween } from './fractional-key.js';
import { generateObjectKeys, objectKeyTag } from './object-keys.js';

const nextId = createSeededIdGenerator(47);

/**
 * Time allowed for a worst-case growth test: its keys reach 2,000 characters, which takes about
 * half a second alone but several under the full suite's coverage instrumentation.
 */
const GROWTH_TIMEOUT_MS = 30_000;
const ids = Array.from({ length: 200 }, () => nextId());

/**
 * Asserts keys are valid and strictly increasing within the bounds.
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
  const bounded = [...(lower === null ? [] : [lower]), ...keys, ...(upper === null ? [] : [upper])];
  for (const key of keys) expect(isValidKey(key), key).toBe(true);
  for (let index = 1; index < bounded.length; index += 1) {
    expect(compareKeys(bounded[index - 1] ?? '', bounded[index] ?? '')).toBeLessThan(0);
  }
}

describe('objectKeyTag', () => {
  it('is a zero separator and four base-62 digits not ending in zero, the same per id', () => {
    for (const id of ids) {
      const tag = objectKeyTag(id);
      expect(tag).toMatch(/^0[0-9A-Za-z]{3}[1-9A-Za-z]$/);
      expect(objectKeyTag(id)).toBe(tag);
    }
  });

  it('differs between the ids of a working board', () => {
    expect(new Set(ids.map(objectKeyTag)).size).toBe(ids.length);
  });
});

describe('generateObjectKeys', () => {
  it('gives each object the plain key followed by its tag', () => {
    const [id] = ids as [ObjectId];
    expect(generateObjectKeys('a0', 'a1', [id])).toEqual([`a0V${objectKeyTag(id)}`]);
    expect(generateObjectKeys('a0', null, [id])).toEqual([`a1${objectKeyTag(id)}`]);
    expect(generateObjectKeys(null, 'a0', [id])).toEqual([`Zz${objectKeyTag(id)}`]);
  });

  it('keeps several objects in order between the same neighbours', () => {
    for (const [lower, upper] of [
      ['a0', 'a1'],
      ['a0', 'a0V'],
      [null, 'a0'],
      ['a0', null],
      [null, null],
      ['Zz', 'a01'],
    ] as const) {
      const keys = generateObjectKeys(lower, upper, ids.slice(0, 37));
      expect(keys).toHaveLength(37);
      expectOrderedBetween(keys, lower, upper);
    }
  });

  it('gives two objects placed in the same gap by two clients different keys', () => {
    const [first, second] = ids as [ObjectId, ObjectId];
    const [fromAda] = generateObjectKeys('a0', 'a1', [first]);
    const [fromBob] = generateObjectKeys('a0', 'a1', [second]);
    expect(fromAda).not.toBe(fromBob);
    expectOrderedBetween([fromAda ?? '', fromBob ?? ''].sort(compareKeys), 'a0', 'a1');
  });

  it('stays in the gap when the plain key is an integer and the upper bound extends it', () => {
    // The plain key between a0 and a1V would be a1, a prefix of the upper bound; a tag appended
    // to a1 could sort above a1V. The generator never returns a prefix of its upper bound.
    const keys = generateObjectKeys('a0', 'a1V', ids.slice(0, 5));
    expectOrderedBetween(keys, 'a0', 'a1V');
    expect(generateKeyBetween('a0', 'a1V')).toBe('a0V');
  });

  it('returns nothing for no objects', () => {
    expect(generateObjectKeys('a0', 'a1', [])).toEqual([]);
  });
});

describe('tagged key growth, the keys the commands write', () => {
  // The worst case: every object lands next to the previous one against one fixed neighbour.
  // The tag's 0 separator stops the next midpoint before the tag, so tagged keys follow the
  // untagged digit cycle (fractional-key.test.ts): at most one character per five inserts
  // upward, per six downward, plus the five tag characters.
  const count = 10_000;
  const nextId = createSeededIdGenerator(2_043);

  it(
    'grows at most one character per five objects placed just below one fixed neighbour',
    () => {
      let lower = 'a0';
      let longest = 0;
      let firstTooLong = 0;
      for (let index = 1; index <= count; index += 1) {
        [lower = ''] = generateObjectKeys(lower, 'a1', [nextId()]);
        longest = Math.max(longest, lower.length);
        if (firstTooLong === 0 && lower.length > MAX_KEY_LENGTH) firstTooLong = index;
      }
      expect(longest).toBeLessThanOrEqual(2 + Math.ceil(count / 5) + 5);
      // 2 + ceil(n / 5) + 5 ≤ 512 holds for n ≤ 2,525.
      expect(firstTooLong).toBeGreaterThan(2_525);
    },
    GROWTH_TIMEOUT_MS,
  );

  it(
    'grows at most one character per six objects placed just above one fixed neighbour',
    () => {
      let upper = 'a1';
      let longest = 0;
      for (let index = 1; index <= count; index += 1) {
        [upper = ''] = generateObjectKeys('a0', upper, [nextId()]);
        longest = Math.max(longest, upper.length);
      }
      expect(longest).toBeLessThanOrEqual(2 + Math.ceil(count / 6) + 5);
    },
    GROWTH_TIMEOUT_MS,
  );

  it(
    'does not depend on the tags: two objects swapped under a neighbour grow the same',
    () => {
      // Tags of every digit, including ones that would have been read into without the separator.
      for (const [first, second] of [
        [ids[0], ids[1]],
        [ids[2], ids[3]],
        [ids[4], ids[5]],
      ] as [ObjectId, ObjectId][]) {
        let [below, above] = ['a0', 'a1'];
        for (let swap = 0; swap < 2_000; swap += 1) {
          const [key = ''] = generateObjectKeys(above, 'a2', [swap % 2 === 0 ? first : second]);
          [below, above] = [above, key];
        }
        expect(above.length).toBeLessThanOrEqual(2 + Math.ceil(2_000 / 5) + 5);
        expect(below < above).toBe(true);
      }
    },
    GROWTH_TIMEOUT_MS,
  );
});

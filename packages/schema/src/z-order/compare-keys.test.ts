import { describe, expect, it } from 'vitest';

import type { ObjectId } from '../ids/object-id.js';

import { compareKeys, compareSiblings } from './compare-keys.js';

const sibling = (id: string, z: string) => ({ id: id as ObjectId, z });

describe('compareKeys', () => {
  it('orders keys by UTF-16 code units, the order the schema states for z', () => {
    expect(compareKeys('Zz', 'a0')).toBeLessThan(0);
    expect(compareKeys('a0', 'a0V')).toBeLessThan(0);
    expect(compareKeys('a0V', 'a0')).toBeGreaterThan(0);
    expect(compareKeys('a0', 'a0')).toBe(0);
    expect(['a1', 'Zz', 'a0V', 'a0', 'b00', 'a0G'].sort(compareKeys)).toEqual([
      'Zz',
      'a0',
      'a0G',
      'a0V',
      'a1',
      'b00',
    ]);
  });

  it('orders by code unit, not by locale: upper case sorts below lower case', () => {
    expect(compareKeys('Z', 'a')).toBeLessThan(0);
    expect(compareKeys('a', 'Z')).toBeGreaterThan(0);
  });
});

describe('compareSiblings', () => {
  it('stacks siblings by z, then by id when two keys are equal', () => {
    const siblings = [sibling('b', 'a0'), sibling('c', 'a1'), sibling('a', 'a0')];
    expect([...siblings].sort(compareSiblings).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });

  it('is zero only for the same key and id, and antisymmetric otherwise', () => {
    expect(compareSiblings(sibling('a', 'a0'), sibling('a', 'a0'))).toBe(0);
    expect(compareSiblings(sibling('a', 'a1'), sibling('b', 'a0'))).toBeGreaterThan(0);
    expect(compareSiblings(sibling('b', 'a0'), sibling('a', 'a1'))).toBeLessThan(0);
  });
});

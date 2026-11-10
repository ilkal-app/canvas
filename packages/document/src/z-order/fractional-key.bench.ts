import { bench, describe } from 'vitest';

import { createSeededIdGenerator } from '@canvas/schema';

import { generateKeyBetween, generateNKeysBetween } from './fractional-key.js';
import { generateObjectKeys } from './object-keys.js';

// Key generation cost: 10k keys at once (a paste or a large move), one
// at a time at the front (object creation), and at random positions in a growing order.

const COUNT = 10_000;
const ids = Array.from({ length: COUNT }, createSeededIdGenerator(47));

describe(`${String(COUNT)} keys`, () => {
  bench('generateNKeysBetween(null, null) at once', () => {
    generateNKeysBetween(null, null, COUNT);
  });

  bench('generateNKeysBetween between two neighbours', () => {
    generateNKeysBetween('a0', 'a1', COUNT);
  });

  bench('generateObjectKeys between two neighbours (tagged)', () => {
    generateObjectKeys('a0', 'a1', ids);
  });

  bench('one at a time at the front', () => {
    let key: string | null = null;
    for (let count = 0; count < COUNT; count += 1) key = generateKeyBetween(key, null);
  });

  bench('one at a time at seeded random positions', () => {
    let state = 7;
    const keys: string[] = [];
    for (let count = 0; count < COUNT; count += 1) {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      const at = Math.floor((state / 2_147_483_648) * (keys.length + 1));
      keys.splice(at, 0, generateKeyBetween(keys[at - 1] ?? null, keys[at] ?? null));
    }
  });
});

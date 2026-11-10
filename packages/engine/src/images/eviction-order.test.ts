import { describe, expect, it } from 'vitest';

import { evictionOrder, planEvictions, type EvictionCandidate } from './eviction-order.js';

function level(
  key: string,
  bytes: number,
  lastUsedFrame: number,
  isNeeded = false,
): EvictionCandidate {
  return { key, bytes, lastUsedFrame, isNeeded };
}

describe('evictionOrder', () => {
  it('puts larger levels first, then the least recently used', () => {
    const order = evictionOrder([
      level('a-128', 64, 10),
      level('b-2048', 16_000, 9),
      level('c-512', 1_000, 3),
      level('d-2048', 16_000, 2),
      level('e-512', 1_000, 8),
    ]);

    expect(order.map(({ key }) => key)).toEqual(['d-2048', 'b-2048', 'c-512', 'e-512', 'a-128']);
  });

  it('never offers a level the viewport needs', () => {
    const order = evictionOrder([level('shown', 16_000, 1, true), level('idle', 64, 5)]);

    expect(order.map(({ key }) => key)).toEqual(['idle']);
  });

  it('does not reorder its input', () => {
    const input = [level('small', 1, 1), level('big', 9, 1)];
    evictionOrder(input);

    expect(input.map(({ key }) => key)).toEqual(['small', 'big']);
  });
});

describe('planEvictions', () => {
  const resident = [
    level('a', 100, 1),
    level('b', 400, 5),
    level('c', 400, 2),
    level('shown', 300, 9, true),
  ];

  it('evicts nothing while the new level fits', () => {
    expect(planEvictions(resident, 1200, 1500, 300)).toEqual({ evict: [], canFit: true });
  });

  it('evicts larger, older levels first until the new level fits', () => {
    // 1200 resident + 500 incoming against 1500: 200 must go; the older 400 is enough.
    expect(planEvictions(resident, 1200, 1500, 500)).toEqual({ evict: ['c'], canFit: true });
    // 700 must go: both 400s.
    expect(planEvictions(resident, 1200, 1500, 1000)).toEqual({ evict: ['c', 'b'], canFit: true });
  });

  it('refuses a level that would not fit even after every idle level went', () => {
    expect(planEvictions(resident, 1200, 1500, 1300)).toEqual({ evict: [], canFit: false });
  });
});

// What a part of a stepped run costs and how parts are packed.
import { describe, expect, it } from 'vitest';

import { isWriteBudget, packByWrites } from './write-budget.js';

const one = (): number => 1;

describe('isWriteBudget', () => {
  it.each([
    [1, true],
    [500, true],
    [0, false],
    [-2, false],
    [2.5, false],
    [Number.NaN, false],
  ])('%s is a budget: %s', (budget, isBudget) => {
    expect(isWriteBudget(budget)).toBe(isBudget);
  });
});

describe('packByWrites', () => {
  it('gives no items one empty part', () => {
    expect(packByWrites([], one, 4)).toEqual([[]]);
  });

  it('packs in order, an item over the budget alone', () => {
    expect(packByWrites([1, 9, 1, 1], (item) => item, 4)).toEqual([[1], [9], [1, 1]]);
  });

  it('keeps room for the first and every part', () => {
    expect(packByWrites([1, 2, 3, 4], one, 3, { first: 2 })).toEqual([[1], [2, 3, 4]]);
    expect(packByWrites([1, 2, 3, 4], one, 3, { each: 1 })).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('adds a last part of its own only when the last one is full', () => {
    expect(packByWrites([1, 2, 3], one, 2, { last: 1 })).toEqual([[1, 2], [3]]);
    expect(packByWrites([1, 2], one, 2, { last: 1 })).toEqual([[1, 2], []]);
    expect(packByWrites([], one, 2, { last: 1 })).toEqual([[]]);
  });
});

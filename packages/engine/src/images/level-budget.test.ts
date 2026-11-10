import { describe, expect, it } from 'vitest';

import { fitLevelsToBudget, type LevelChoice } from './level-budget.js';

const LEVELS = [128, 512, 2048];

function square(assetId: string, chosen: number): LevelChoice {
  return { assetId, levels: LEVELS, chosen, bytesOf: (edge) => edge * edge * 4 };
}

describe('fitLevelsToBudget', () => {
  it('keeps every choice that fits', () => {
    const fitted = fitLevelsToBudget([square('a', 2048), square('b', 512)], 64 * 1024 * 1024);

    expect(Object.fromEntries(fitted)).toEqual({ a: 2048, b: 512 });
  });

  it('steps the costliest choice down first', () => {
    // 2048² × 4 = 16 MiB each; 20 MiB fits one 2048 and one 512 (1 MiB).
    const fitted = fitLevelsToBudget([square('a', 2048), square('b', 2048)], 20 * 1024 * 1024);

    expect(Object.fromEntries(fitted)).toEqual({ a: 512, b: 2048 });
  });

  it('never goes below the smallest level, even over budget', () => {
    const fitted = fitLevelsToBudget([square('a', 2048), square('b', 2048)], 1);

    expect(Object.fromEntries(fitted)).toEqual({ a: 128, b: 128 });
  });

  it('is deterministic whatever the input order', () => {
    const forward = fitLevelsToBudget([square('a', 2048), square('b', 2048)], 20 * 1024 * 1024);
    const backward = fitLevelsToBudget([square('b', 2048), square('a', 2048)], 20 * 1024 * 1024);

    expect(Object.fromEntries(backward)).toEqual(Object.fromEntries(forward));
  });
});

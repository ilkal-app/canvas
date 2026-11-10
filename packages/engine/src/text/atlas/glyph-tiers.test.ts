import { describe, expect, it } from 'vitest';

import {
  atlasTierOf,
  BASE_TIER,
  cappedTextTier,
  HIGH_TIER,
  lowerTiers,
  MAX_TIER,
  mayChangeTier,
  pickAvailable,
  pickTier,
  VECTOR_TIER,
} from './glyph-tiers.js';

// Ported from the prototype's `src/atlas/tiers.test.ts`, plus the tier hysteresis.
describe('pickTier', () => {
  it('serves each tier up to 2× magnification of its texels', () => {
    expect(pickTier(24)).toBe(BASE_TIER);
    expect(pickTier(128)).toBe(BASE_TIER);
    expect(pickTier(128.1)).toBe(HIGH_TIER);
    expect(pickTier(512)).toBe(HIGH_TIER);
    expect(pickTier(512.1)).toBe(MAX_TIER);
    expect(pickTier(1536)).toBe(MAX_TIER);
  });

  it('keeps the previous tier until the size crosses its boundary by the margin', () => {
    expect(pickTier(135, BASE_TIER)).toBe(BASE_TIER);
    expect(pickTier(141, BASE_TIER)).toBe(HIGH_TIER);
    expect(pickTier(120, HIGH_TIER)).toBe(HIGH_TIER);
    expect(pickTier(115, HIGH_TIER)).toBe(BASE_TIER);
    expect(pickTier(540, HIGH_TIER)).toBe(HIGH_TIER);
    expect(pickTier(470, MAX_TIER)).toBe(MAX_TIER);
    expect(pickTier(450, MAX_TIER)).toBe(HIGH_TIER);
  });

  it('jumps straight to the right tier after a large zoom step', () => {
    expect(pickTier(2000, BASE_TIER)).toBe(MAX_TIER);
    expect(pickTier(10, MAX_TIER)).toBe(BASE_TIER);
  });
});

describe('lowerTiers', () => {
  it('lists the fallback tiers highest first', () => {
    expect(lowerTiers(MAX_TIER)).toEqual([HIGH_TIER, BASE_TIER]);
    expect(lowerTiers(HIGH_TIER)).toEqual([BASE_TIER]);
    expect(lowerTiers(BASE_TIER)).toEqual([]);
  });
});

describe('pickAvailable', () => {
  it('returns the requested tier when it has an entry', () => {
    expect(pickAvailable(MAX_TIER, () => 'glyph')).toEqual({ entry: 'glyph', tier: MAX_TIER });
  });

  it('cascades to the highest lower tier that has an entry', () => {
    const entries = new Map([[BASE_TIER, 'base']]);
    const asked: number[] = [];
    const picked = pickAvailable(MAX_TIER, (tier) => {
      asked.push(tier);
      return entries.get(tier);
    });
    expect(picked).toEqual({ entry: 'base', tier: BASE_TIER });
    expect(asked).toEqual([MAX_TIER, HIGH_TIER, BASE_TIER]);
  });

  it('stops at the first tier that has an entry', () => {
    const asked: number[] = [];
    const picked = pickAvailable(MAX_TIER, (tier) => {
      asked.push(tier);
      return tier === HIGH_TIER ? 'high' : undefined;
    });
    expect(picked?.tier).toBe(HIGH_TIER);
    expect(asked).toEqual([MAX_TIER, HIGH_TIER]);
  });

  it('returns undefined when no tier has an entry', () => {
    expect(pickAvailable(HIGH_TIER, () => undefined)).toBeUndefined();
  });
});

describe('mayChangeTier', () => {
  it('is true exactly where pickTier can answer differently, whatever the previous tier', () => {
    const sizes = [1, 100, 115.2, 120, 128, 130, 140.8, 200, 460.8, 500, 512, 540, 563.2, 900];
    const previousTiers = [undefined, BASE_TIER, HIGH_TIER, MAX_TIER] as const;
    for (const from of sizes) {
      for (const to of sizes) {
        const canChange = previousTiers.some((previous) => {
          const before = pickTier(from, previous);
          return pickTier(to, before) !== before;
        });
        if (canChange)
          expect(mayChangeTier(from, to), `${String(from)} to ${String(to)}`).toBe(true);
      }
    }
  });

  it('is false for a zoom that stays between two edges', () => {
    expect(mayChangeTier(20, 100)).toBe(false);
    expect(mayChangeTier(150, 450)).toBe(false);
    expect(mayChangeTier(600, 5_000)).toBe(false);
  });
});

describe('the vector tier under an atlas cap', () => {
  it('caps atlas tiers and keeps the vector tier, which falls back to the cap', () => {
    expect(cappedTextTier(MAX_TIER, HIGH_TIER)).toBe(HIGH_TIER);
    expect(cappedTextTier(BASE_TIER, HIGH_TIER)).toBe(BASE_TIER);
    expect(cappedTextTier(MAX_TIER, undefined)).toBe(MAX_TIER);
    expect(cappedTextTier(VECTOR_TIER, BASE_TIER)).toBe(VECTOR_TIER);
    expect(atlasTierOf(VECTOR_TIER, HIGH_TIER)).toBe(HIGH_TIER);
    expect(atlasTierOf(VECTOR_TIER)).toBe(MAX_TIER);
  });
});

// Acceptance: vector selection is exactly the 512 atlas tier with an opt-in draw mode.
import { describe, expect, it } from 'vitest';

import {
  atlasTierOf,
  BASE_TIER,
  HIGH_TIER,
  MAX_TIER,
  mayChangeTier,
  pickTextTier,
  pickTier,
  VECTOR_TIER,
  type TextTier,
} from './glyph-tiers.js';

describe('vector text tier acceptance', () => {
  it('selects vector only when enabled and the 512 tier is selected', () => {
    expect(VECTOR_TIER).toBe('vector');
    expect(pickTextTier(512)).toBe(HIGH_TIER);
    expect(pickTextTier(512, undefined, { isVectorEnabled: true })).toBe(HIGH_TIER);
    expect(pickTextTier(512.01, undefined, { isVectorEnabled: true })).toBe(VECTOR_TIER);
    expect(pickTextTier(900)).toBe(MAX_TIER);
    expect(pickTextTier(900, undefined, { isVectorEnabled: false })).toBe(MAX_TIER);
    expect(pickTextTier(900, undefined, { isVectorEnabled: true })).toBe(VECTOR_TIER);
  });

  it('keeps vector through 460.8 and enters it only above 563.2 from the 256 tier', () => {
    const lowerEdge = 512 * 0.9;
    const upperEdge = 512 * 1.1;
    const enabled = { isVectorEnabled: true };
    expect(pickTextTier(lowerEdge, VECTOR_TIER, enabled)).toBe(VECTOR_TIER);
    expect(pickTextTier(lowerEdge - 0.01, VECTOR_TIER, enabled)).toBe(HIGH_TIER);
    expect(pickTextTier(512, VECTOR_TIER, enabled)).toBe(VECTOR_TIER);
    expect(pickTextTier(512, HIGH_TIER, enabled)).toBe(HIGH_TIER);
    expect(pickTextTier(upperEdge, HIGH_TIER, enabled)).toBe(HIGH_TIER);
    expect(pickTextTier(upperEdge + 0.01, HIGH_TIER, enabled)).toBe(VECTOR_TIER);
  });

  it('maps vector to the 512 atlas tier and drops back to atlas when disabled', () => {
    expect(atlasTierOf(VECTOR_TIER)).toBe(MAX_TIER);
    expect(atlasTierOf(BASE_TIER)).toBe(BASE_TIER);
    expect(atlasTierOf(HIGH_TIER)).toBe(HIGH_TIER);
    expect(atlasTierOf(MAX_TIER)).toBe(MAX_TIER);
    expect(pickTextTier(512, VECTOR_TIER)).toBe(MAX_TIER);
    expect(pickTextTier(470, VECTOR_TIER, { isVectorEnabled: false })).toBe(MAX_TIER);
    expect(pickTextTier(450, VECTOR_TIER, { isVectorEnabled: false })).toBe(HIGH_TIER);
  });

  it('agrees with the existing raster selector after mapping the previous tier', () => {
    const sizes = [10, 115.2, 128, 140.8, 300, 460.8, 512, 563.2, 900];
    const previousTiers: readonly (TextTier | undefined)[] = [
      undefined,
      BASE_TIER,
      HIGH_TIER,
      MAX_TIER,
      VECTOR_TIER,
    ];
    for (const screenEm of sizes) {
      for (const previous of previousTiers) {
        const raster = pickTier(
          screenEm,
          previous === undefined ? undefined : atlasTierOf(previous),
        );
        for (const isVectorEnabled of [false, true]) {
          const expected = raster === MAX_TIER && isVectorEnabled ? VECTOR_TIER : raster;
          expect(
            pickTextTier(screenEm, previous, { isVectorEnabled }),
            `${String(screenEm)}, ${String(previous)}, ${String(isVectorEnabled)}`,
          ).toBe(expected);
        }
      }
    }
  });

  it('mayChangeTier flags every edge where text tier selection can change', () => {
    const sizes = [
      1, 100, 115.19, 115.2, 115.21, 127.99, 128, 128.01, 140.8, 150, 300, 460.79, 460.8, 460.81,
      511.99, 512, 512.01, 563.2, 563.21, 900,
    ];
    const previousTiers: readonly (TextTier | undefined)[] = [
      undefined,
      BASE_TIER,
      HIGH_TIER,
      MAX_TIER,
      VECTOR_TIER,
    ];
    for (const fromEm of sizes) {
      for (const toEm of sizes) {
        if (mayChangeTier(fromEm, toEm)) continue;
        for (const previous of previousTiers) {
          for (const isVectorEnabled of [false, true]) {
            const options = { isVectorEnabled };
            expect(
              pickTextTier(toEm, previous, options),
              `${String(fromEm)} to ${String(toEm)}, ${String(previous)}, ${String(isVectorEnabled)}`,
            ).toBe(pickTextTier(fromEm, previous, options));
          }
        }
      }
    }
  });
});

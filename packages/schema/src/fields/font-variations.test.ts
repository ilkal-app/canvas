import { describe, expect, it } from 'vitest';

import { isSameFontVariations } from './font-variations.js';

describe('isSameFontVariations', () => {
  it('treats absent and empty as the same on either side', () => {
    expect(isSameFontVariations(undefined, {})).toBe(true);
    expect(isSameFontVariations({}, undefined)).toBe(true);
    expect(isSameFontVariations({ wght: 600 }, undefined)).toBe(false);
  });

  it('tells apart coordinates on different axes', () => {
    expect(isSameFontVariations({ wght: 600 }, { wdth: 600 })).toBe(false);
  });
});

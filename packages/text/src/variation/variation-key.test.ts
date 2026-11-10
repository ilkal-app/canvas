import { describe, expect, it, vi } from 'vitest';

interface VariationKeyModule {
  variationKey: (normalised: Readonly<Record<string, number>>) => string;
}

const { variationKey } = await vi.importActual<VariationKeyModule>('./variation-key.js');

describe('variation cache key', () => {
  it('sorts tags and gives equal coordinates the same stable representation', () => {
    expect(variationKey({ wght: 550, wdth: 90.0625 })).toBe('wdth=90.0625;wght=550');
    expect(variationKey({ wdth: 90.0625, wght: 550.0 })).toBe(
      variationKey({ wght: 550, wdth: 90.0625 }),
    );
  });

  it('keeps distinct normalized coordinates distinct', () => {
    expect(variationKey({ wght: 550 })).not.toBe(variationKey({ wght: 550.0625 }));
    expect(variationKey({ wght: 550 })).not.toBe(variationKey({ wdth: 550 }));
  });

  it('uses the empty string for the default instance', () => {
    expect(variationKey({})).toBe('');
  });
});

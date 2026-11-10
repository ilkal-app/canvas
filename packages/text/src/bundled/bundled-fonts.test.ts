import { describe, expect, it } from 'vitest';

import { BUNDLED_FONT_FAMILIES, bundledFamilyMetrics } from './bundled-fonts.js';

describe('bundledFamilyMetrics', () => {
  it('decodes a bundled family once and shares the result', () => {
    expect(BUNDLED_FONT_FAMILIES).toContain('Lora');
    const first = bundledFamilyMetrics('Lora');
    expect(first?.map(({ face }) => face.family)).toEqual(['Lora', 'Lora', 'Lora', 'Lora']);
    expect(bundledFamilyMetrics('Lora')).toBe(first);
  });

  it('knows no family it does not bundle, an inherited name included', () => {
    expect(bundledFamilyMetrics('Comic Sans MS')).toBeUndefined();
    expect(bundledFamilyMetrics('constructor')).toBeUndefined();
  });
});

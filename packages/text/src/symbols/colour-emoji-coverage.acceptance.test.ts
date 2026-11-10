import { describe, expect, it } from 'vitest';

import { EMOJI_FAMILY } from '../script/fallback-families.js';

import { SYMBOL_COVERAGE_FAMILIES, symbolCoverageFamilies } from './symbol-coverage.js';

describe('Noto Color Emoji symbol coverage', () => {
  it('uses only the color family for emoji presentation', () => {
    expect(EMOJI_FAMILY).toBe('Noto Color Emoji');
    expect(SYMBOL_COVERAGE_FAMILIES).toContain('Noto Color Emoji');
    expect(SYMBOL_COVERAGE_FAMILIES).not.toContain('Noto Emoji');
    expect(symbolCoverageFamilies('👍')).toContain('Noto Color Emoji');
    expect(symbolCoverageFamilies('❤️')).toContain('Noto Color Emoji');
    expect(symbolCoverageFamilies('©')).not.toContain('Noto Color Emoji');
    expect(symbolCoverageFamilies('👍❤️')).not.toContain('Noto Emoji');
  });
});

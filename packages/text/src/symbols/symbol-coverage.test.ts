import { describe, expect, it } from 'vitest';

import { SYMBOL_COVERAGE_FAMILIES, symbolCoverageFamilies } from './symbol-coverage.js';

describe('symbolCoverageFamilies', () => {
  it('requests nothing for plain text', () => {
    expect(symbolCoverageFamilies('Hello, world… 2 × 3')).toEqual([]);
  });

  it('requests the math face for arrows and operators, the symbols face for dingbats', () => {
    expect(symbolCoverageFamilies('Next →')).toEqual(['Noto Sans Math']);
    expect(symbolCoverageFamilies('More ⋯')).toEqual(['Noto Sans Math']);
    expect(symbolCoverageFamilies('Done ✓')).toEqual(['Noto Sans Symbols 2']);
    expect(symbolCoverageFamilies('⋯ ✓ ← ★ ☰')).toEqual(['Noto Sans Math', 'Noto Sans Symbols 2']);
  });

  it('lists each symbol family once, in fallback order', () => {
    expect(SYMBOL_COVERAGE_FAMILIES).toEqual([
      'Noto Sans Math',
      'Noto Sans Symbols 2',
      'Noto Color Emoji',
    ]);
  });
});

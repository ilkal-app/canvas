import { describe, expect, it } from 'vitest';

import { isCoverageFamily } from './coverage-family.js';
import { SCRIPT_COVERAGE_FAMILIES } from './script-coverage.js';
import { SYMBOL_COVERAGE_FAMILIES } from './symbol-coverage.js';

describe('coverage family classification', () => {
  it('includes every script and symbol coverage family', () => {
    for (const family of [...SCRIPT_COVERAGE_FAMILIES, ...SYMBOL_COVERAGE_FAMILIES]) {
      expect(isCoverageFamily(family), family).toBe(true);
    }
  });

  it('excludes library families, including names that begin with Noto Sans', () => {
    for (const family of ['Inter', 'Roboto', 'Noto Sans', 'Noto Sans Display']) {
      expect(isCoverageFamily(family), family).toBe(false);
    }
  });
});

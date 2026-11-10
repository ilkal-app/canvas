import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SIZED_COVERAGE, SIZED_FAMILIES } from '../__fixtures__/sized-metrics.js';
import { LINE_BREAKING_VERSION } from '../line-break/line-break-version.js';
import {
  FALLBACK_RULES,
  fallbackFamiliesOf,
  SCRIPT_FALLBACKS,
} from '../script/fallback-families.js';
import { SHAPER_VERSION } from '../shaping/shaper.js';

import { BUNDLED_FONTS_FINGERPRINT } from './fonts-fingerprint.js';

describe('bundled font fingerprint includes the Unicode line-breaking rules', () => {
  it('names UAX #14 at Unicode 17.0.0', () => {
    expect(LINE_BREAKING_VERSION).toContain('uax14');
    expect(LINE_BREAKING_VERSION).toContain('17.0.0');
  });

  it('hashes families, coverage, shaper, and line-breaking version together', () => {
    // Adds the script fallback table to the same hash.
    const data = JSON.stringify({
      families: SIZED_FAMILIES,
      coverage: SIZED_COVERAGE,
      shaper: SHAPER_VERSION,
      lineBreaking: LINE_BREAKING_VERSION,
      scriptFallbacks: SCRIPT_FALLBACKS.map(([script]) => [script, fallbackFamiliesOf(script)]),
      fallbackRules: FALLBACK_RULES,
    });
    expect(BUNDLED_FONTS_FINGERPRINT).toBe(
      createHash('sha256').update(data).digest('hex').slice(0, 16),
    );
  });
});

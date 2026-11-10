import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  BUNDLED_FONTS_FINGERPRINT,
  fallbackFamiliesOf,
  hasScriptCoverage,
  SCRIPT_COVERAGE_FAMILIES,
  scriptCoverageFamilies,
} from '@canvas/text';

import { SIZED_COVERAGE, SIZED_FAMILIES } from '../__fixtures__/sized-metrics.js';
import { LINE_BREAKING_VERSION } from '../line-break/line-break-version.js';
import { SHAPER_VERSION } from '../shaping/shaper.js';

import { FALLBACK_RULES, SCRIPT_FALLBACKS } from './fallback-families.js';

const CASES = [
  ['Hani', '\u4f60', 'Noto Sans SC'],
  ['Hira', '\u3042', 'Noto Sans JP'],
  ['Kana', '\u30a2', 'Noto Sans JP'],
  ['Hang', '\ud55c', 'Noto Sans KR'],
  ['Arab', '\u0639', 'Noto Sans Arabic'],
  ['Deva', '\u0915', 'Noto Sans Devanagari'],
  ['Hebr', '\u05d0', 'Noto Sans Hebrew'],
  ['Thai', '\u0e01', 'Noto Sans Thai'],
  ['Beng', '\u0995', 'Noto Sans Bengali'],
  ['Taml', '\u0b95', 'Noto Sans Tamil'],
  ['Telu', '\u0c15', 'Noto Sans Telugu'],
  ['Knda', '\u0c95', 'Noto Sans Kannada'],
  ['Mlym', '\u0d15', 'Noto Sans Malayalam'],
  ['Geor', '\u10d0', 'Noto Sans Georgian'],
  ['Armn', '\u0561', 'Noto Sans Armenian'],
  ['Ethi', '\u12a0', 'Noto Sans Ethiopic'],
  ['Khmr', '\u1780', 'Noto Sans Khmer'],
  ['Mymr', '\u1000', 'Noto Sans Myanmar'],
  ['Sinh', '\u0d9a', 'Noto Sans Sinhala'],
  ['Laoo', '\u0e81', 'Noto Sans Lao'],
] as const;

describe('script coverage compatibility', () => {
  it('pins the old regex API outputs for one character from each supported script', () => {
    const expectedFamilies = [...new Set(CASES.map(([, , family]) => family))];
    // Later faces come after these, which keep their order.
    expect(SCRIPT_COVERAGE_FAMILIES.slice(0, expectedFamilies.length)).toEqual(expectedFamilies);
    for (const [, character, family] of CASES) {
      expect(scriptCoverageFamilies(character)).toEqual([family]);
      expect(hasScriptCoverage(character.codePointAt(0) ?? 0)).toBe(true);
    }
    expect(scriptCoverageFamilies('A123\u{1f600}')).toEqual([]);
    expect(hasScriptCoverage('A'.codePointAt(0) ?? 0)).toBe(false);
  });

  it('maps the supported scripts through the table and leaves all others empty', () => {
    for (const [script, , family] of CASES) expect(fallbackFamiliesOf(script)).toEqual([family]);
    for (const script of ['Latn', 'Zyyy', 'Zinh', 'Zzzz', 'Cyrl', 'Grek'] as const) {
      expect(fallbackFamiliesOf(script)).toEqual([]);
    }
    expect(scriptCoverageFamilies('\u3042\u4f60')).toEqual(['Noto Sans SC', 'Noto Sans JP']);
  });

  it('includes the script mapping in the bundled font fingerprint', () => {
    // Every row of the table (later rows come after these cases').
    const scriptFallbacks = SCRIPT_FALLBACKS.map(([script]) => [
      script,
      fallbackFamiliesOf(script),
    ]);
    const data = JSON.stringify({
      families: SIZED_FAMILIES,
      coverage: SIZED_COVERAGE,
      shaper: SHAPER_VERSION,
      lineBreaking: LINE_BREAKING_VERSION,
      scriptFallbacks,
      // Han by language and kana paragraphs change which face sets a text.
      fallbackRules: FALLBACK_RULES,
    });
    expect(BUNDLED_FONTS_FINGERPRINT).toBe(
      createHash('sha256').update(data).digest('hex').slice(0, 16),
    );
  });
});

import { describe, expect, it } from 'vitest';

import {
  hasScriptCoverage,
  SCRIPT_COVERAGE_FAMILIES,
  scriptCoverageFamilies,
} from './script-coverage.js';

describe('scriptCoverageFamilies', () => {
  it('requests nothing for Latin text and symbols', () => {
    expect(scriptCoverageFamilies('Hello, world ⋯ ✓')).toEqual([]);
  });

  it('requests one face per script present, in list order', () => {
    expect(scriptCoverageFamilies('你好')).toEqual(['Noto Sans SC']);
    expect(scriptCoverageFamilies('שלום مرحبا 안녕')).toEqual([
      'Noto Sans KR',
      'Noto Sans Arabic',
      'Noto Sans Hebrew',
    ]);
  });
});

describe('hasScriptCoverage', () => {
  it('holds for a character of a script the app has a face for', () => {
    for (const character of ['你', 'カ', '한', 'م', 'क', 'ש', 'ก']) {
      expect(hasScriptCoverage(character.codePointAt(0) ?? 0)).toBe(true);
    }
  });

  it('does not hold for Latin, symbols, emoji or private use', () => {
    for (const codePoint of [0x41, 0x22ef, 0x2713, 0x1f600, 0xe000]) {
      expect(hasScriptCoverage(codePoint)).toBe(false);
    }
  });
});

describe('SCRIPT_COVERAGE_FAMILIES', () => {
  it('lists the script faces once each, in list order', () => {
    // 19, then a face for every script Noto covers, Han's TC and HK.
    expect(SCRIPT_COVERAGE_FAMILIES).toHaveLength(75);
    expect(SCRIPT_COVERAGE_FAMILIES).toEqual(
      expect.arrayContaining(['Noto Sans TC', 'Noto Sans HK']),
    );
    expect(SCRIPT_COVERAGE_FAMILIES[0]).toBe('Noto Sans SC');
    expect(new Set(SCRIPT_COVERAGE_FAMILIES).size).toBe(SCRIPT_COVERAGE_FAMILIES.length);
  });
});

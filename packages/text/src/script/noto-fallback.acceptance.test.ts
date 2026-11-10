/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseFont } from '../font/parse-font.js';
import { SCRIPT_COVERAGE_FAMILIES } from '../symbols/script-coverage.js';
import { SYMBOL_COVERAGE_FAMILIES } from '../symbols/symbol-coverage.js';

import { fallbackFamiliesOf, SCRIPT_FALLBACKS } from './fallback-families.js';
import { scriptOf } from './script-table.js';

const COVERAGE = new URL('../../../app/assets/fonts/script-coverage/', import.meta.url);
const CATALOGUE = JSON.parse(readFileSync(new URL('catalogue.json', COVERAGE), 'utf8')) as {
  entries: readonly {
    family: string;
    faces: readonly { weight: number; isItalic: boolean; url: string }[];
  }[];
};

describe('Noto script fallback', () => {
  it('makes every imported script face reachable through fallbackFamiliesOf', () => {
    const reachable = new Set(
      SCRIPT_FALLBACKS.flatMap(([script]) => [
        ...fallbackFamiliesOf(script),
        ...fallbackFamiliesOf(script, 'ja'),
        ...fallbackFamiliesOf(script, 'ko'),
        ...fallbackFamiliesOf(script, 'zh-Hant'),
        ...fallbackFamiliesOf(script, 'zh-HK'),
      ]),
    );
    for (const family of SCRIPT_COVERAGE_FAMILIES) {
      expect(reachable.has(family), family).toBe(true);
    }
    for (const { family } of CATALOGUE.entries) {
      if (!SYMBOL_COVERAGE_FAMILIES.includes(family)) {
        expect(reachable.has(family), family).toBe(true);
      }
    }
  });

  it('resolves each listed UCD script to a bundled face whose cmap draws it', () => {
    const samples = new Map<string, number[]>();
    for (let point = 0; point < 0x40000; point += 1) {
      const script = scriptOf(point);
      const list = samples.get(script) ?? [];
      if (list.length < 32) list.push(point);
      samples.set(script, list);
    }
    const entries = new Map(CATALOGUE.entries.map((entry) => [entry.family, entry]));
    for (const [script] of SCRIPT_FALLBACKS) {
      const [family] = fallbackFamiliesOf(script);
      const entry = entries.get(family ?? '');
      const file = entry?.faces.find((face) => face.weight === 400 && !face.isItalic)?.url;
      expect(file, `${script}: ${family ?? ''}`).toBeDefined();
      const font = parseFont(readFileSync(new URL(file ?? '', COVERAGE)));
      expect(
        (samples.get(script) ?? []).some((point) => font.glyphIdOf(point) !== 0),
        `${script}: ${family ?? ''}`,
      ).toBe(true);
    }
  }, 60_000);
});

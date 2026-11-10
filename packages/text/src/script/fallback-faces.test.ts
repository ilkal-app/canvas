/// <reference types="node" />
// Every row of the script table names a real script and a face the app bundles that
// draws that script; and the emoji face draws emoji. Reads the faces from the app's assets.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseFont } from '../font/parse-font.js';

import { EMOJI_FAMILY, SCRIPT_FALLBACKS } from './fallback-families.js';
import { SCRIPT_CODES, scriptOf } from './script-table.js';

const COVERAGE = new URL('../../../app/assets/fonts/script-coverage/', import.meta.url);

/** The catalogue's regular face file of each coverage family. */
const REGULAR_FILES = new Map(
  (
    JSON.parse(readFileSync(new URL('catalogue.json', COVERAGE), 'utf8')) as {
      entries: readonly {
        family: string;
        faces: readonly { weight: number; isItalic: boolean; url: string }[];
      }[];
    }
  ).entries.map((entry) => [
    entry.family,
    entry.faces.find((face) => !face.isItalic && face.weight === 400)?.url ??
      entry.faces[0]?.url ??
      '',
  ]),
);

/**
 * Up to eight codepoints of each script, from the start of Unicode.
 *
 * @returns The codepoints, by script.
 */
function samplesByScript(): Map<string, number[]> {
  const samples = new Map<string, number[]>();
  for (let codepoint = 0; codepoint < 0x40000; codepoint += 1) {
    const script = scriptOf(codepoint);
    const list = samples.get(script) ?? [];
    if (list.length < 8) list.push(codepoint);
    samples.set(script, list);
  }
  return samples;
}

describe('the script fallback table', () => {
  it('names real scripts, each once', () => {
    const scripts = SCRIPT_FALLBACKS.map(([script]) => script);
    for (const script of scripts) expect(SCRIPT_CODES).toContain(script);
    expect(new Set(scripts).size).toBe(scripts.length);
  });

  it('names faces the app bundles, each drawing its script', () => {
    const samples = samplesByScript();
    const fonts = new Map<string, ReturnType<typeof parseFont>>();
    for (const [script, family] of SCRIPT_FALLBACKS) {
      const file = REGULAR_FILES.get(family);
      expect(file, family).toBeTruthy();
      let font = fonts.get(family);
      if (font === undefined) {
        font = parseFont(readFileSync(new URL(file ?? '', COVERAGE)));
        fonts.set(family, font);
      }
      const drawn = (samples.get(script) ?? []).filter((point) => font.glyphIdOf(point) !== 0);
      expect(drawn.length, `${family} for ${script}`).toBeGreaterThan(0);
    }
  }, 60_000);

  it('bundles the emoji face, which draws emoji', () => {
    const font = parseFont(readFileSync(new URL(REGULAR_FILES.get(EMOJI_FAMILY) ?? '', COVERAGE)));
    for (const emoji of ['\u{1f600}', '❤', '\u{1f44d}']) {
      expect(font.glyphIdOf(emoji.codePointAt(0) ?? 0), emoji).not.toBe(0);
    }
  });
});

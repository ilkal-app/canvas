// CoverageNeedsCache: a typed character rescans its own chunk of the text, not the
// whole draft, and the needs are always what `coverageNeeds` gives for the whole text.
import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { CoverageNeedsCache } from './coverage-needs-cache.js';
import { coverageNeeds } from './coverage-needs.js';

const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

/**
 * A seeded generator of numbers in [0, 1) (mulberry32).
 *
 * @param seed - The seed.
 * @returns The generator.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Pieces a random text is made of: Latin, Han, kana, Hangul, Arabic, astral Han, symbols, breaks. */
const PIECES = [
  'the ',
  'quick ',
  'brown ',
  '中文',
  '日本語',
  'かな',
  'カナ',
  '한국',
  'عربي',
  '\u{20000}',
  '→',
  '★',
  '\n',
  ' ',
  ' ',
];

/** Run styles a random text's runs take. */
const RUN_STYLES: readonly Partial<TextStyle>[] = [
  {},
  { weight: 700 },
  { lang: 'ja' },
  { lang: 'zh-Hant' },
  { fontFamily: 'Noto Sans JP' },
  { fontFamily: 'Noto Sans KR', weight: 600 },
];

/**
 * A random piece of text.
 *
 * @param random - The generator.
 * @param count - How many pieces.
 * @returns The text.
 */
function randomText(random: () => number, count: number): string {
  let text = '';
  for (let index = 0; index < count; index += 1) {
    text += PIECES[Math.floor(random() * PIECES.length)] ?? '';
  }
  return text;
}

/**
 * Random runs over a text, never splitting a surrogate pair.
 *
 * @param random - The generator.
 * @param text - The text.
 * @returns The runs.
 */
function randomRuns(random: () => number, text: string): StyleRun[] {
  const runs: StyleRun[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + 1 + Math.floor(random() * 300));
    if (end < text.length && /[\uDC00-\uDFFF]/u.test(text.charAt(end))) end += 1;
    const style = RUN_STYLES[Math.floor(random() * RUN_STYLES.length)] ?? {};
    runs.push({ length: end - start, style: { ...STYLE, ...style } });
    start = end;
  }
  // Now and then runs that outlast the text, as coverageNeeds reads them too.
  if (random() < 0.3) {
    const style = RUN_STYLES[Math.floor(random() * RUN_STYLES.length)] ?? {};
    runs.push({ length: Math.floor(random() * 3), style: { ...STYLE, ...style } });
  }
  return runs;
}

/**
 * A text of seeded Latin words, about `length` UTF-16 units long, one paragraph.
 *
 * @param length - About how long.
 * @returns The text.
 */
function latinText(length: number): string {
  const random = seeded(7);
  const words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit'];
  let text = '';
  while (text.length < length) text += `${words[Math.floor(random() * words.length)] ?? ''} `;
  return text;
}

describe('CoverageNeedsCache', () => {
  it('gives what coverageNeeds gives for the whole text, edit after edit', () => {
    const random = seeded(514);
    const cache = new CoverageNeedsCache();
    let text = randomText(random, 400);
    for (let step = 0; step < 300; step += 1) {
      // An insertion, a deletion or a replacement somewhere in the text, as typing and pasting do.
      const at = Math.floor(random() * (text.length + 1));
      const cut = Math.min(text.length - at, Math.floor(random() * 4));
      const inserted = random() < 0.7 ? randomText(random, 1 + Math.floor(random() * 3)) : '';
      text = text.slice(0, at) + inserted + text.slice(at + cut);
      // Never leave half a surrogate pair: drop lone halves the cut made.
      text = text.replace(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu,
        '',
      );
      const runs = step % 3 === 0 ? undefined : randomRuns(random, text);
      expect(cache.needs(text, runs)).toEqual(coverageNeeds(text, runs));
    }
  });

  it('rescans only the typed character’s chunk of a long draft', () => {
    const cache = new CoverageNeedsCache();
    const text = latinText(12_000);
    const runs = [{ length: text.length, style: STYLE }];
    cache.needs(text, runs);
    expect(cache.scannedCodepoints).toBeGreaterThanOrEqual(text.length);
    const middle = text.indexOf(' ', 6_000) + 1;
    const typed = `${text.slice(0, middle)}x${text.slice(middle)}`;
    const typedRuns = [{ length: typed.length, style: STYLE }];
    expect(cache.needs(typed, typedRuns)).toEqual(coverageNeeds(typed, typedRuns));
    // A chunk is about 64 units: one keystroke looks up the scripts and languages of a few
    // chunks' characters, never the 12,000. (Finding the cuts still walks every unit, with no
    // lookups: arithmetic on each unit, which the typing benchmark measures.)
    expect(cache.scannedCodepoints).toBeLessThan(600);
    // The same draft again reads nothing.
    cache.needs(typed, typedRuns);
    expect(cache.scannedCodepoints).toBe(0);
  });

  it('reads Han again across its paragraph when kana is typed into it', () => {
    const cache = new CoverageNeedsCache();
    const han = '中文字'.repeat(400);
    expect(cache.needs(han)).toEqual(coverageNeeds(han));
    // Kana at the end makes the whole paragraph Japanese, so its Han goes to the Japanese face.
    const japanese = `${han}かな`;
    const needs = cache.needs(japanese, [{ length: japanese.length, style: STYLE }]);
    expect(needs).toEqual(coverageNeeds(japanese, [{ length: japanese.length, style: STYLE }]));
    expect(needs.map(({ family }) => family)).toEqual(['Noto Sans JP']);
  });

  it('reads runs past the text’s end as coverageNeeds does', () => {
    const cache = new CoverageNeedsCache();
    const text = 'a'.repeat(512);
    const runs = [
      { length: 512, style: STYLE },
      { length: 1, style: { ...STYLE, fontFamily: 'Noto Sans JP' } },
    ];
    expect(cache.needs(text, runs)).toEqual(coverageNeeds(text, runs));
    expect(cache.needs(text, runs)).toEqual([
      { family: 'Noto Sans JP', slices: ['base'], weights: [400] },
    ]);
  });

  it('stays right when its chunks are evicted', () => {
    const cache = new CoverageNeedsCache(4);
    const random = seeded(9);
    for (let step = 0; step < 20; step += 1) {
      const text = randomText(random, 300);
      expect(cache.needs(text)).toEqual(coverageNeeds(text));
      expect(cache.needs(text)).toEqual(coverageNeeds(text));
    }
  });

  it('reads a short text whole, as coverageNeeds does', () => {
    const cache = new CoverageNeedsCache();
    expect(cache.needs('中かな한')).toEqual(coverageNeeds('中かな한'));
    expect(cache.scannedCodepoints).toBe(4);
  });
});

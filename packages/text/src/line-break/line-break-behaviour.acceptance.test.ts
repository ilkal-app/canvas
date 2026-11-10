import { describe, expect, it } from 'vitest';

import { lineBreakOpportunities } from './line-breaks.js';

/**
 * UTF-16 offsets where a new line may begin.
 *
 * @param text - Source text.
 * @returns Legal offsets.
 */
function breaks(text: string): number[] {
  return lineBreakOpportunities(text).map(({ index }) => index);
}

/**
 * Word boundaries inside a dictionary segmented sentence.
 *
 * @param text - Source text.
 * @param locale - Language tag.
 * @returns Internal word boundaries.
 */
function wordBoundaries(text: string, locale: string): Set<number> {
  return new Set(
    [...new Intl.Segmenter(locale, { granularity: 'word' }).segment(text)]
      .map(({ index }) => index)
      .filter((index) => index > 0 && index < text.length),
  );
}

describe('Unicode 17 default line breaking', () => {
  it('breaks between Han, hiragana, and katakana characters', () => {
    const text = '漢字かなカナ';
    expect(breaks(text)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps closing punctuation on the preceding CJK line and opening punctuation on the next', () => {
    for (const closing of ['。', '、', '」', '）']) {
      expect(breaks(`漢${closing}字`)).not.toContain(1);
    }
    for (const opening of ['「', '（']) {
      expect(breaks(`漢${opening}字`)).not.toContain(2);
    }
  });

  it('resolves CJ small kana as NS, blocking a break before but allowing one after', () => {
    // LB1 maps CJ to NS; LB21 forbids a break before NS, while LB31 permits one after it.
    expect(breaks('アァイ')).toEqual([2, 3]);
  });

  it('recognizes each mandatory separator and keeps CR LF together', () => {
    for (const separator of ['\r\n', '\r', '\u0085', '\u2028', '\u2029', '\n', '\v', '\f']) {
      const text = `a${separator}b`;
      const mandatory = lineBreakOpportunities(text).filter(({ isMandatory }) => isMandatory);
      expect(mandatory.map(({ index }) => index)).toEqual([1 + separator.length, text.length]);
      if (separator === '\r\n') expect(breaks(text)).not.toContain(2);
    }
  });

  it('does not split glue or a word joiner and breaks after zero width space', () => {
    for (const glue of ['\u00a0', '\u202f', '\u2060']) {
      expect(breaks(`a${glue}b`)).toEqual([3]);
    }
    expect(breaks('a\u200bb')).toEqual([2, 3]);
  });

  it('breaks after a noninitial hyphen and around spaced em dash', () => {
    expect(breaks('self-aware')).toEqual([5, 10]);
    expect(breaks('a — b')).toEqual([2, 4, 5]);
  });

  it('keeps monetary decimals and fractions together', () => {
    expect(breaks('$12.50')).toEqual([6]);
    expect(breaks('1/2')).toEqual([3]);
  });

  it('keeps emoji ZWJ sequences, modifier sequences, and regional indicator pairs intact', () => {
    for (const emoji of ['👩\u200d💻', '👩🏽', '🇺🇸']) {
      expect(breaks(emoji)).toEqual([emoji.length]);
    }
    const flags = '🇺🇸🇨🇦';
    expect(breaks(flags)).toEqual([4, 8]);
  });

  it('adds only Intl word boundaries inside Thai, Lao, and Khmer SA runs by default', () => {
    for (const [locale, text] of [
      ['th', 'ภาษาไทยง่ายนิดเดียว'],
      ['lo', 'ພາສາລາວຮຽນງ່າຍ'],
      ['km', 'ភាសាខ្មែរងាយស្រួល'],
    ] as const) {
      const internal = breaks(text).filter((index) => index < text.length);
      const boundaries = wordBoundaries(text, locale);
      expect(internal.length, locale).toBeGreaterThan(0);
      for (const index of internal)
        expect(boundaries.has(index), `${locale} index ${String(index)}`).toBe(true);
      expect(
        lineBreakOpportunities(text, { complexContext: 'none' }).map(({ index }) => index),
      ).toEqual([text.length]);
    }
  });

  it('breaks after a run of spaces and never before or within it', () => {
    expect(breaks('a  b')).toEqual([3, 4]);
  });
});

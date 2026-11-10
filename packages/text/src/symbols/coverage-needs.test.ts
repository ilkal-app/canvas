// Which CJK slices and weights a text asks each face for.
import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { coverageNeeds } from './coverage-needs.js';

const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

/**
 * Runs over consecutive pieces of a text.
 *
 * @param pieces - Each piece's text and its style changes.
 * @returns The runs.
 */
function runsOf(...pieces: readonly (readonly [string, Partial<TextStyle>])[]): StyleRun[] {
  return pieces.map(([text, style]) => ({ length: text.length, style: { ...STYLE, ...style } }));
}

describe('coverageNeeds', () => {
  it('asks each CJK face only for its own characters and weights', () => {
    const text = '中文日本語';
    const runs = runsOf(['中文', { lang: 'zh-Hans' }], ['日本語', { lang: 'ja', weight: 700 }]);
    expect(coverageNeeds(text, runs)).toEqual([
      { family: 'Noto Sans SC', slices: ['base', 'han-0'], weights: [400] },
      { family: 'Noto Sans JP', slices: ['base', 'han-0'], weights: [700] },
    ]);
  });

  it('asks a CJK family a run names by slice, never whole', () => {
    const text = 'a中';
    const needs = coverageNeeds(text, runsOf([text, { fontFamily: 'Noto Sans SC' }]));
    expect(needs).toEqual([{ family: 'Noto Sans SC', slices: ['base', 'han-0'], weights: [400] }]);
    // Untagged Han in a run naming the Japanese face: that face only, never SC's base too.
    expect(coverageNeeds('\u4E2D', runsOf(['\u4E2D', { fontFamily: 'Noto Sans JP' }]))).toEqual([
      { family: 'Noto Sans JP', slices: ['base', 'han-0'], weights: [400] },
    ]);
  });

  it('asks the Japanese face for kana alone, and the Korean face for Hangul', () => {
    expect(coverageNeeds('かな')).toEqual([
      { family: 'Noto Sans JP', slices: ['base'], weights: [400] },
    ]);
    expect(coverageNeeds('한국')).toEqual([
      { family: 'Noto Sans KR', slices: ['base', 'hangul-1', 'hangul-0'], weights: [400] },
    ]);
  });

  it('reads astral Han whole and draws weights above 500 bold', () => {
    const text = '\u{20000}\u4E2D';
    const runs = runsOf(['\u{20000}', { weight: 600 }], ['\u4E2D', { weight: 500 }]);
    expect(coverageNeeds(text, runs)).toEqual([
      { family: 'Noto Sans SC', slices: ['base', 'han-x-115', 'han-0'], weights: [700, 400] },
    ]);
  });

  it('leaves a non-CJK coverage family whole', () => {
    expect(coverageNeeds('שלום')).toEqual([{ family: 'Noto Sans Hebrew' }]);
  });
});

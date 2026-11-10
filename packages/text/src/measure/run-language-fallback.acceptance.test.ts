import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { fallbackRuns, type FallbackFace } from './fallback-runs.js';

const STYLE: TextStyle = {
  fontFamily: 'Own',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

/**
 * A loaded face with exact codepoint coverage.
 *
 * @param family - Its family.
 * @param characters - The characters its cmap covers.
 * @returns The fallback face.
 */
function face(family: string, characters: string): FallbackFace {
  const points = new Set(Array.from(characters, (character) => character.codePointAt(0)));
  return { family, weight: 400, isItalic: false, covers: (point) => points.has(point) };
}

/**
 * Resolves each stored run with a face missing every Han character.
 *
 * @param text - Text to lay out.
 * @param style - Its stored style.
 * @param candidates - Loaded fallback faces.
 * @returns Chosen family for each resulting run.
 */
function families(text: string, style: TextStyle, candidates: readonly FallbackFace[]): string[] {
  const runs: StyleRun[] = [{ length: text.length, style }];
  return fallbackRuns(text, runs, () => face('Own', ''), candidates).map(
    (run) => run.style.fontFamily,
  );
}

const JP = face(
  'Noto Sans JP',
  '\u65e5\u672c\u8a9e\u306e\u30c6\u30ad\u30b9\u30c8\u4e2d\u6587\u6f22\u5b57\u304b\u306a',
);
const SC = face('Noto Sans SC', '\u65e5\u672c\u8a9e\u4e2d\u6587\u672c\u6f22\u5b57');
const TC = face('Noto Sans TC', '\u4e2d\u6587');

describe('language aware fallback runs', () => {
  it('uses JP for untagged Han in a Japanese paragraph', () => {
    expect(
      new Set(families('\u65e5\u672c\u8a9e\u306e\u30c6\u30ad\u30b9\u30c8', STYLE, [SC, JP])),
    ).toEqual(new Set(['Noto Sans JP']));
  });

  it('uses SC for untagged Chinese and JP for ja-tagged Chinese', () => {
    expect(families('\u4e2d\u6587\u6587\u672c', STYLE, [JP, SC])).toEqual(['Noto Sans SC']);
    expect(families('\u4e2d\u6587', { ...STYLE, lang: 'ja' }, [SC, JP])).toEqual(['Noto Sans JP']);
  });

  it('does not borrow kana from a previous paragraph', () => {
    const text = '\u304b\u306a\n\u6f22\u5b57';
    expect(families(text, STYLE, [JP, SC])).toEqual(['Noto Sans JP', 'Own', 'Noto Sans SC']);
  });

  it('takes TC when loaded and SC when TC is unavailable for zh-Hant', () => {
    expect(families('\u4e2d\u6587', { ...STYLE, lang: 'zh-Hant' }, [SC, TC])).toEqual([
      'Noto Sans TC',
    ]);
    expect(families('\u4e2d\u6587', { ...STYLE, lang: 'zh-Hant' }, [SC])).toEqual(['Noto Sans SC']);
  });
});

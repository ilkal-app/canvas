import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { scriptCoverageFamilies } from './script-coverage.js';

const STYLE: TextStyle = {
  fontFamily: 'Own',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

/**
 * One run covering all characters.
 *
 * @param text - Its text.
 * @param lang - Its language, if explicit.
 * @returns A single stored run.
 */
function runs(text: string, lang?: string): StyleRun[] {
  return [{ length: text.length, style: { ...STYLE, ...(lang === undefined ? {} : { lang }) } }];
}

describe('script coverage requested for run language', () => {
  it('loads JP for ja-tagged Han without also requesting SC', () => {
    expect(scriptCoverageFamilies('\u4e2d\u6587', runs('\u4e2d\u6587', 'ja'))).toEqual([
      'Noto Sans JP',
    ]);
  });

  it('loads JP alone for untagged Japanese Han and kana', () => {
    const text = '\u65e5\u672c\u8a9e\u306e\u30c6\u30ad\u30b9\u30c8';
    expect(scriptCoverageFamilies(text, runs(text))).toEqual(['Noto Sans JP']);
  });

  it('loads SC for Chinese, and preserves the old no-runs behaviour', () => {
    expect(scriptCoverageFamilies('\u4e2d\u6587', runs('\u4e2d\u6587'))).toEqual(['Noto Sans SC']);
    expect(scriptCoverageFamilies('\u4e2d\u6587')).toEqual(['Noto Sans SC']);
  });
});

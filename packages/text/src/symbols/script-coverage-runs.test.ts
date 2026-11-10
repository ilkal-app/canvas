// Each Han character takes its own run's language, read in one pass.
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
 * A run of one character, with a language or none.
 *
 * @param lang - Its language, if any.
 * @returns The run.
 */
function run(lang?: string): StyleRun {
  return { length: 1, style: lang === undefined ? STYLE : { ...STYLE, lang } };
}

describe('scriptCoverageFamilies over several runs', () => {
  it('reads each Han character in its own run language', () => {
    expect(scriptCoverageFamilies('中文字', [run('ja'), run('ko'), run()])).toEqual([
      'Noto Sans SC',
      'Noto Sans JP',
      'Noto Sans KR',
    ]);
  });

  it('reads characters past the last run as untagged', () => {
    expect(scriptCoverageFamilies('中文', [run('ja')])).toEqual(['Noto Sans SC', 'Noto Sans JP']);
    expect(scriptCoverageFamilies('中', [])).toEqual(['Noto Sans SC']);
  });
});

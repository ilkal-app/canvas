import { describe, expect, it } from 'vitest';

import { fallbackFamiliesOf } from './fallback-families.js';

describe('Han fallback families by run language', () => {
  it.each([
    ['ja', ['Noto Sans JP', 'Noto Sans SC']],
    ['ja-JP', ['Noto Sans JP', 'Noto Sans SC']],
    ['ko', ['Noto Sans KR', 'Noto Sans SC']],
    ['ko-KR', ['Noto Sans KR', 'Noto Sans SC']],
    ['zh-Hant', ['Noto Sans TC', 'Noto Sans SC']],
    ['zh-Hant-TW', ['Noto Sans TC', 'Noto Sans SC']],
    ['zh-TW', ['Noto Sans TC', 'Noto Sans SC']],
    ['zh-MO', ['Noto Sans TC', 'Noto Sans SC']],
    ['zh-HK', ['Noto Sans HK', 'Noto Sans TC', 'Noto Sans SC']],
    ['zh', ['Noto Sans SC']],
    ['zh-Hans', ['Noto Sans SC']],
    ['zh-CN', ['Noto Sans SC']],
    ['zh-SG', ['Noto Sans SC']],
    ['yue', ['Noto Sans SC']],
  ] as const)('orders Han faces for %s', (lang, families) => {
    expect(fallbackFamiliesOf('Hani', lang)).toEqual(families);
  });

  it('uses SC for untagged Han and ignores language for kana and Hangul', () => {
    expect(fallbackFamiliesOf('Hani')).toEqual(['Noto Sans SC']);
    expect(fallbackFamiliesOf('Hira', 'zh-Hant')).toEqual(['Noto Sans JP']);
    expect(fallbackFamiliesOf('Kana', 'zh-HK')).toEqual(['Noto Sans JP']);
    expect(fallbackFamiliesOf('Hang', 'ja')).toEqual(['Noto Sans KR']);
  });
});

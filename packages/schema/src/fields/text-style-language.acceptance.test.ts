import { describe, expect, it } from 'vitest';

import { overrideRecordSchema, textStyleOverrideSchema } from '../instances/instance-overrides.js';

import { isSameTextStyle, styleRunSchema, textStyleSchema } from './text-style.js';

const STYLE = {
  fontFamily: 'DM Sans',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
} as const;

describe('run language validation', () => {
  it.each([
    'ja',
    'zh-Hant',
    'zh-Hant-TW',
    'en-US',
    'zh-HK',
    'yue',
    'ja-aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaa',
  ])('accepts the BCP 47 tag %s on a strict text style and a run', (lang) => {
    expect(textStyleSchema.safeParse({ ...STYLE, lang }).success).toBe(true);
    expect(styleRunSchema.safeParse({ length: 1, style: { ...STYLE, lang } }).success).toBe(true);
  });

  it.each(['', 'japanese!', 'e', 'ja-aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaa', 'a'.repeat(36)])(
    'refuses the invalid language tag %s',
    (lang) => {
      expect(textStyleSchema.safeParse({ ...STYLE, lang }).success).toBe(false);
    },
  );

  it('keeps an absent tag optional and distinguishes two otherwise equal styles by language', () => {
    expect(textStyleSchema.safeParse(STYLE).success).toBe(true);
    expect(isSameTextStyle({ ...STYLE, lang: 'ja' }, { ...STYLE, lang: 'zh' })).toBe(false);
  });

  it('accepts language in instance override text styles and replacement runs', () => {
    expect(textStyleOverrideSchema.safeParse({ lang: 'ja' }).success).toBe(true);
    expect(
      overrideRecordSchema.safeParse({
        text: 'A',
        runs: [{ length: 1, style: { ...STYLE, lang: 'ja' } }],
      }).success,
    ).toBe(true);
    expect(textStyleOverrideSchema.safeParse({ lang: 'japanese!' }).success).toBe(false);
  });
});

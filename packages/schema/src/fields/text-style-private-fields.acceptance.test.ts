// Acceptance (Claude), our decision: a shared document stores only a run's family
// name, weight and slant (with size and colour); no private-font category, no font bytes and no
// local-file reference ever enter a text style. The schema refuses them, so no client can add
// them in passing.
import { describe, expect, it } from 'vitest';

import { styleRunSchema, textStyleSchema, type TextStyle } from './text-style.js';

const PRIVATE: TextStyle = {
  fontFamily: 'Private Mono',
  fontSize: 24,
  color: [0.1, 0.1, 0.12, 1],
  weight: 700,
  italic: false,
};

describe('a text style stores only family, weight and slant', () => {
  it('accepts a private family name as plain text, like any other name', () => {
    const parsed = textStyleSchema.safeParse(PRIVATE);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(PRIVATE);
    expect(Object.keys(parsed.data ?? {}).sort()).toEqual(
      ['color', 'fontFamily', 'fontSize', 'italic', 'weight'].sort(),
    );
  });

  it('refuses any private-font metadata beside the name', () => {
    const extras: readonly Record<string, unknown>[] = [
      { fontCategory: 'mono' },
      { category: 'handwriting' },
      { fontBytes: 'AAEAAAAQ' },
      { fontUrl: 'file:///Users/someone/Library/Fonts/Private.ttf' },
      { postscriptName: 'PrivateMono-Regular' },
      { fallbackFamily: 'JetBrains Mono' },
      { isLocal: true },
    ];
    for (const extra of extras) {
      const key = Object.keys(extra)[0] ?? '';
      expect(textStyleSchema.safeParse({ ...PRIVATE, ...extra }).success, key).toBe(false);
      expect(
        styleRunSchema.safeParse({ length: 5, style: { ...PRIVATE, ...extra } }).success,
        key,
      ).toBe(false);
    }
  });

  it('keeps weights to the nine CSS weights, a family drawing a missing one with its nearest face', () => {
    for (const weight of [100, 300, 500, 600, 900]) {
      expect(textStyleSchema.safeParse({ ...PRIVATE, weight }).success, String(weight)).toBe(true);
    }
    for (const weight of [0, 50, 450, 1000, '700', 700.5]) {
      expect(textStyleSchema.safeParse({ ...PRIVATE, weight }).success, String(weight)).toBe(false);
    }
  });
});

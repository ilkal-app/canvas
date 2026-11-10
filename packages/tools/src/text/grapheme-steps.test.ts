import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as GraphemeSteps from './grapheme-steps.js';
import { nextGraphemeIndex, previousGraphemeIndex } from './grapheme-steps.js';

/** A family: man, ZWJ, woman, ZWJ, girl; 8 UTF-16 code units, one cluster. */
const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
/** A flag: two regional indicators, one cluster. */
const FLAG = '\u{1F1EB}\u{1F1F7}';
/** "e" with a combining acute accent, one cluster. */
const ACCENTED = 'é';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('grapheme steps', () => {
  it('steps back over a whole cluster: an emoji sequence, a flag, a letter with its mark', () => {
    for (const cluster of [FAMILY, FLAG, ACCENTED]) {
      const text = `a${cluster}b`;
      expect(previousGraphemeIndex(text, 1 + cluster.length), cluster).toBe(1);
      expect(nextGraphemeIndex(text, 1), cluster).toBe(1 + cluster.length);
    }
  });

  it('steps one character in plain text and stops at the edges', () => {
    expect(previousGraphemeIndex('abc', 2)).toBe(1);
    expect(nextGraphemeIndex('abc', 1)).toBe(2);
    expect(previousGraphemeIndex('abc', 0)).toBe(0);
    expect(nextGraphemeIndex('abc', 3)).toBe(3);
  });

  it('finds the cluster before a caret deep in a long text', () => {
    const text = `${'x'.repeat(500)}${FLAG}${FLAG}`;
    expect(previousGraphemeIndex(text, text.length)).toBe(text.length - FLAG.length);
    expect(nextGraphemeIndex(text, 500)).toBe(500 + FLAG.length);
  });

  it('falls back to one code point where Intl.Segmenter is missing', async () => {
    // An Intl without Segmenter, as in an older runtime.
    vi.stubGlobal('Intl', {});
    vi.resetModules();
    const steps: typeof GraphemeSteps = await import('./grapheme-steps.js');
    const text = `a${ACCENTED}${FLAG}`;
    expect(steps.previousGraphemeIndex(text, text.length)).toBe(text.length - 2);
    expect(steps.nextGraphemeIndex(text, 1)).toBe(2);
  });
});

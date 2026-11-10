import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { wordEndAfter, wordRangeAt, wordStartBefore } from './word-ranges.js';

interface WordRanges {
  wordEndAfter: typeof wordEndAfter;
  wordRangeAt: typeof wordRangeAt;
  wordStartBefore: typeof wordStartBefore;
}

const DEVANAGARI_LETTER = /[\u0904-\u0939]/u;
const TEXT = 'नमस्ते दुनिया';

const REAL_SEGMENTER = Intl.Segmenter;

class FirefoxLikeSegmenter extends REAL_SEGMENTER {
  override segment(input: string): Intl.Segments {
    const segments = super.segment(input);
    if (this.resolvedOptions().granularity !== 'word') return segments;
    // A generator is not the lib's SegmentIterator (it lacks the iterator helpers), which
    // word-ranges.ts never calls: it only iterates.
    return {
      containing: (index?: number) => segments.containing(index),
      *[Symbol.iterator]() {
        for (const segment of segments) {
          yield {
            ...segment,
            isWordLike: segment.isWordLike && !DEVANAGARI_LETTER.test(segment.segment),
          };
        }
      },
    } as unknown as Intl.Segments;
  }
}

const devanagariCases: readonly { name: string; check: (ranges: WordRanges) => void }[] = [
  {
    name: 'moves right to the end of the first word',
    check: ({ wordEndAfter }) => {
      expect(wordEndAfter(TEXT, 0)).toBe(6);
    },
  },
  {
    name: 'moves right past the space to the end of the second word',
    check: ({ wordEndAfter }) => {
      expect(wordEndAfter(TEXT, 6)).toBe(13);
    },
  },
  {
    name: 'moves left to the start of the second word',
    check: ({ wordStartBefore }) => {
      expect(wordStartBefore(TEXT, 13)).toBe(7);
    },
  },
  {
    name: 'moves left to the start of the first word',
    check: ({ wordStartBefore }) => {
      expect(wordStartBefore(TEXT, 6)).toBe(0);
    },
  },
  {
    name: 'selects the first word from within it',
    check: ({ wordRangeAt }) => {
      expect(wordRangeAt(TEXT, 2)).toEqual([0, 6]);
    },
  },
];

afterEach(() => vi.unstubAllGlobals());

describe.each([
  { name: 'Firefox-like segmenter', isFirefoxLike: true },
  { name: 'real segmenter', isFirefoxLike: false },
])('$name', ({ isFirefoxLike }) => {
  beforeEach(() => {
    if (isFirefoxLike) {
      vi.stubGlobal(
        'Intl',
        Object.assign(Object.create(Intl) as typeof Intl, {
          Segmenter: FirefoxLikeSegmenter,
        }),
      );
    }
    // word-ranges caches segmenters by locale, so each test must create its own module instance.
    vi.resetModules();
  });

  it.each(devanagariCases)('$name', async ({ check }) => {
    check(await import('./word-ranges.js'));
  });

  it('skips spaces, punctuation and emoji when moving right', async () => {
    const { wordEndAfter } = await import('./word-ranges.js');
    expect(wordEndAfter('a , 👍 b', 1)).toBe(8);
  });

  it('selects a run of other characters around punctuation', async () => {
    const { wordRangeAt } = await import('./word-ranges.js');
    expect(wordRangeAt('a , b', 2)).toEqual([1, 4]);
  });
  // A variation selector and a combining mark are marks, not letters, so
  // an emoji or a lone mark stays a non-word, as Chrome's segmenter has it.
  it('skips an emoji with its variation selector and a ZWJ sequence when moving right', async () => {
    const { wordEndAfter } = await import('./word-ranges.js');
    expect(wordEndAfter('a ❤️ b', 1)).toBe(6);
    expect(wordEndAfter('a 👩‍❤️‍👨 b', 1)).toBe('a 👩‍❤️‍👨 b'.length);
  });

  it('keeps an emoji and a lone combining mark in the run of other characters', async () => {
    const { wordRangeAt } = await import('./word-ranges.js');
    expect(wordRangeAt('a ❤️ b', 2)).toEqual([1, 5]);
    expect(wordRangeAt('a \u0301 b', 2)).toEqual([1, 4]);
  });
});

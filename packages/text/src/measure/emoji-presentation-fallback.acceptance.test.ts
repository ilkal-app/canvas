import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { EMOJI_FAMILY } from '../script/fallback-families.js';

import { clusterFaces, fallbackRuns, type FallbackFace } from './fallback-runs.js';

const STYLE: TextStyle = {
  fontFamily: 'Own',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

/**
 * A loaded face with an exact codepoint coverage set.
 *
 * @param family - Face family.
 * @param characters - Scalars in its cmap.
 * @returns The face.
 */
function face(family: string, characters: string): FallbackFace {
  const covered = new Set(Array.from(characters, (character) => character.codePointAt(0) ?? 0));
  return { family, weight: 400, isItalic: false, covers: (point) => covered.has(point) };
}

/**
 * Creates one stored run over the entire UTF-16 string.
 *
 * @param text - Run text.
 * @returns A single run.
 */
function whole(text: string): StyleRun[] {
  return [{ length: text.length, style: STYLE }];
}

/**
 * The length and selected family of each layout run.
 *
 * @param runs - Layout runs.
 * @returns UTF-16 lengths and families.
 */
function ranges(runs: readonly StyleRun[]): readonly (readonly [number, string])[] {
  return runs.map((run) => [run.length, run.style.fontFamily]);
}

describe('emoji-presentation face choice', () => {
  it.each([
    '👍',
    '❤️',
    '👨‍👩‍👧',
    '👍🏽',
    '🇺🇸',
    '\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}',
    '1️⃣',
  ])('puts the emoji face ahead of a covering own face for %s', (text) => {
    const own = face('Own', text);
    const emoji = face(EMOJI_FAMILY, text);
    const candidates = [face('Other', text), emoji];
    const clusters = clusterFaces(text, whole(text), () => own, candidates);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.map((cluster) => cluster.face)).toEqual([emoji]);
    expect(ranges(fallbackRuns(text, whole(text), () => own, candidates))).toEqual([
      [text.length, EMOJI_FAMILY],
    ]);
  });

  it.each(['❤', '❤︎', '👍︎', '1', '#', '©'])(
    'keeps text-presentation cluster %s in its covering own face',
    (text) => {
      const own = face('Own', text);
      const emoji = face(EMOJI_FAMILY, text);
      expect(clusterFaces(text, whole(text), () => own, [emoji])[0]?.[0]?.face).toBe(own);
      expect(ranges(fallbackRuns(text, whole(text), () => own, [emoji]))).toEqual([
        [text.length, 'Own'],
      ]);
    },
  );

  it('keeps the covering own face when the emoji face misses part of a ZWJ sequence', () => {
    const text = '👨‍👩‍👧';
    const own = face('Own', text);
    const incompleteEmoji = face(EMOJI_FAMILY, '👨👩');
    expect(clusterFaces(text, whole(text), () => own, [incompleteEmoji])[0]?.[0]?.face).toBe(own);
    expect(ranges(fallbackRuns(text, whole(text), () => own, [incompleteEmoji]))).toEqual([
      [text.length, 'Own'],
    ]);
  });

  it('splits only around the emoji cluster and keeps surrounding text in its own face', () => {
    const emojiText = '👍🏽';
    const text = `ab${emojiText}cd`;
    const own = face('Own', text);
    const emoji = face(EMOJI_FAMILY, emojiText);
    expect(ranges(fallbackRuns(text, whole(text), () => own, [emoji]))).toEqual([
      [2, 'Own'],
      [emojiText.length, EMOJI_FAMILY],
      [2, 'Own'],
    ]);
  });

  it('preserves the original run when no emoji face is loaded', () => {
    const text = 'ab👍🏽cd';
    const runs = whole(text);
    const own = face('Own', text);
    expect(fallbackRuns(text, runs, () => own, [])).toBe(runs);
    expect(ranges(fallbackRuns(text, runs, () => own, [face('Other', text)]))).toEqual([
      [text.length, 'Own'],
    ]);
  });
});

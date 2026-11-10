import { describe, expect, it } from 'vitest';

import type { StyleRun } from '@canvas/schema';

import { EMOJI_FAMILY } from '../script/fallback-families.js';

import { fallbackRuns, type FallbackFace } from './fallback-runs.js';

/**
 * A loaded face with the test's exact cmap.
 *
 * @param family - Face family.
 * @param characters - Scalars in its cmap.
 * @returns The face.
 */
function face(family: string, characters: string): FallbackFace {
  const covered = new Set(Array.from(characters, (character) => character.codePointAt(0)));
  return { family, weight: 400, isItalic: false, covers: (point) => covered.has(point) };
}

/**
 * The selected family for one grapheme.
 *
 * @param text - The grapheme.
 * @param own - The stored run's face.
 * @param candidates - Coverage faces in load order.
 * @returns The selected family.
 */
function selectedFamily(text: string, own: FallbackFace, candidates: FallbackFace[]): string {
  const runs: StyleRun[] = [
    {
      length: text.length,
      style: { fontFamily: 'Own', fontSize: 20, color: 'ink', weight: 400, italic: false },
    },
  ];
  return fallbackRuns(text, runs, () => own, candidates)[0]?.style.fontFamily ?? '';
}

describe('emoji fallback', () => {
  it('chooses the emoji face when a symbol face also maps an emoji presentation character', () => {
    const emoji = '👍';
    expect(
      selectedFamily(emoji, face('Own', ''), [
        face('Noto Sans Symbols 2', emoji),
        face(EMOJI_FAMILY, emoji),
      ]),
    ).toBe(EMOJI_FAMILY);
  });

  // A run's own face that maps the base keeps it for now: putting the emoji face ahead of the
  // run's own face for VS16 is's emoji-presentation step, as agreed on.
  it('chooses the emoji face for an explicit emoji variation sequence its own face lacks', () => {
    const heart = '❤';
    expect(
      selectedFamily(`${heart}\ufe0f`, face('Own', ''), [
        face('Noto Sans Symbols 2', heart),
        face(EMOJI_FAMILY, heart),
      ]),
    ).toBe(EMOJI_FAMILY);
  });

  it('keeps a text-presentation symbol in the symbol face loaded first', () => {
    const heart = '❤';
    expect(
      selectedFamily(heart, face('Own', ''), [
        face('Noto Sans Symbols 2', heart),
        face(EMOJI_FAMILY, heart),
      ]),
    ).toBe('Noto Sans Symbols 2');
  });
});

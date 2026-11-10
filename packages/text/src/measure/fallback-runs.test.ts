// A run its own face draws whole still passes its script to the text after it.
import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { fallbackRuns, type FallbackFace } from './fallback-runs.js';

const STYLE: TextStyle = {
  fontFamily: 'Thai Own',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

/**
 * A fake face mapping exactly some characters.
 *
 * @param family - Its family.
 * @param characters - The characters it maps.
 * @returns The face.
 */
function face(family: string, characters: string): FallbackFace {
  const covered = new Set(Array.from(characters, (character) => character.codePointAt(0)));
  return { family, weight: 400, isItalic: false, covers: (point) => covered.has(point) };
}

describe('fallbackRuns script context', () => {
  it("carries a fully drawn run's script into the next run", () => {
    const text = '\u0e01!';
    const runs: StyleRun[] = [
      { length: 1, style: STYLE },
      { length: 1, style: { ...STYLE, fontFamily: 'Latin Own' } },
    ];
    const faces = new Map([
      ['Thai Own', face('Thai Own', '\u0e01')],
      ['Latin Own', face('Latin Own', '')],
    ]);
    const candidates = [face('Noto Sans Math', '!'), face('Noto Sans Thai', '!\u0e01')];
    const laid = fallbackRuns(text, runs, (run) => faces.get(run.style.fontFamily), candidates);
    expect(laid.map((run) => run.style.fontFamily)).toEqual(['Thai Own', 'Noto Sans Thai']);
  });

  it('carries the script before a run of Common characters its face draws', () => {
    const text = '\u0e01 1!';
    const runs: StyleRun[] = [
      { length: 1, style: STYLE },
      { length: 2, style: { ...STYLE, fontFamily: 'Digits' } },
      { length: 1, style: { ...STYLE, fontFamily: 'Latin Own' } },
    ];
    const faces = new Map([
      ['Thai Own', face('Thai Own', '\u0e01')],
      ['Digits', face('Digits', ' 1')],
      ['Latin Own', face('Latin Own', '')],
    ]);
    const candidates = [face('Noto Sans Math', '!'), face('Noto Sans Thai', '!')];
    const laid = fallbackRuns(text, runs, (run) => faces.get(run.style.fontFamily), candidates);
    expect(laid.at(-1)?.style.fontFamily).toBe('Noto Sans Thai');
  });
});

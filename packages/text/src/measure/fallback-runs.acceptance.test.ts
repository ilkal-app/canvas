import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import { fallbackRuns, type FallbackFace } from '@canvas/text';

const STYLE: TextStyle = {
  fontFamily: 'Own',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};

/**
 * A fake loaded face with an exact codepoint coverage set.
 *
 * @param family - Face family.
 * @param characters - Scalars in its cmap.
 * @param weight - Face weight.
 * @param isItalic - Face slant.
 * @returns A face with exact coverage.
 */
function face(
  family: string,
  characters: string,
  weight: 400 | 700 = 400,
  isItalic = false,
): FallbackFace {
  const covered = new Set(Array.from(characters, (character) => character.codePointAt(0) ?? 0));
  return { family, weight, isItalic, covers: (point) => covered.has(point) };
}

/**
 * Creates one stored run over the entire UTF-16 string.
 *
 * @param text - Run text.
 * @param style - Stored style.
 * @returns A single run.
 */
function whole(text: string, style: TextStyle = STYLE): StyleRun[] {
  return [{ length: text.length, style }];
}

/**
 * Reads the observable layout ranges without depending on style object shape.
 *
 * @param runs - Layout runs.
 * @returns Their lengths and families.
 */
function ranges(runs: readonly StyleRun[]): readonly (readonly [number, string])[] {
  return runs.map((run) => [run.length, run.style.fontFamily]);
}

describe('fallbackRuns', () => {
  it('keeps a base and its combining mark together in a face covering both', () => {
    const text = 'a\u0301b';
    const runs = whole(text);
    const original = face('Own', 'ab');
    const fallback = face('Marks', 'a\u0301');
    expect(ranges(fallbackRuns(text, runs, () => original, [fallback]))).toEqual([
      [2, 'Marks'],
      [1, 'Own'],
    ]);
    expect(runs).toEqual(whole(text));
  });

  it('keeps a ZWJ family emoji in one face and ignores ZWJ for coverage', () => {
    const text = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}';
    const runs = fallbackRuns(text, whole(text), () => face('Own', ''), [
      face('Emoji', '\u{1f468}\u{1f469}\u{1f467}'),
    ]);
    expect(ranges(runs)).toEqual([[text.length, 'Emoji']]);
  });

  it('ignores VS16, tag characters, CGJ and ZWNJ when testing coverage', () => {
    const text = '\u2764\ufe0f\u034f\u200c\u{e0061}\u{e007f}';
    const runs = whole(text);
    expect(fallbackRuns(text, runs, () => face('Own', '\u2764'), [face('Emoji', '\u2764')])).toBe(
      runs,
    );
  });

  it('leaves Common digits in the own face between Thai words when it covers them', () => {
    const text = '\u0e01 123 \u0e02';
    const runs = whole(text);
    expect(
      ranges(fallbackRuns(text, runs, () => face('Own', ' 123'), [face('Noto Sans Thai', text)])),
    ).toEqual([
      [1, 'Noto Sans Thai'],
      [5, 'Own'],
      [1, 'Noto Sans Thai'],
    ]);
  });

  it('prefers script family, then matching weight and italic, over candidate load order', () => {
    const text = '\u0e01';
    const style = { ...STYLE, weight: 700 as const, italic: true };
    const candidates = [
      face('Other', text, 700, true),
      face('Noto Sans Thai', text),
      face('Noto Sans Thai', text, 700, true),
    ];
    expect(
      ranges(fallbackRuns(text, whole(text, style), () => face('Own', ''), candidates)),
    ).toEqual([[1, 'Noto Sans Thai']]);
    expect(
      fallbackRuns(text, whole(text, style), () => face('Own', ''), candidates)[0]?.style.weight,
    ).toBe(700);
    expect(
      ranges(
        fallbackRuns('x', whole('x', style), () => face('Own', ''), [
          face('Regular', 'x'),
          face('Matching', 'x', 700, true),
        ]),
      ),
    ).toEqual([[1, 'Matching']]);
  });

  it('merges adjacent clusters selected into one fallback family', () => {
    expect(
      ranges(fallbackRuns('xy', whole('xy'), () => face('Own', ''), [face('Other', 'xy')])),
    ).toEqual([[2, 'Other']]);
  });

  it('uses the first fully covering general face, then one covering the first drawn codepoint', () => {
    const text = 'a\u0301';
    expect(
      ranges(
        fallbackRuns(text, whole(text), () => face('Own', ''), [
          face('Partial', 'a'),
          face('Full', text),
        ]),
      ),
    ).toEqual([[2, 'Full']]);
    expect(
      ranges(fallbackRuns(text, whole(text), () => face('Own', ''), [face('Partial', 'a')])),
    ).toEqual([[2, 'Partial']]);
    expect(
      ranges(fallbackRuns(text, whole(text), () => face('Own', ''), [face('Neither', 'z')])),
    ).toEqual([[2, 'Own']]);
  });

  it('returns unchanged run objects when no fallback is needed and the input array with no candidates', () => {
    const text = 'abc';
    const runs = whole(text);
    expect(fallbackRuns(text, runs, () => face('Own', text), [face('Other', text)])).toEqual(runs);
    expect(fallbackRuns(text, runs, () => face('Own', text), [face('Other', text)])[0]).toBe(
      runs[0],
    );
    expect(fallbackRuns(text, runs, () => undefined, [])).toBe(runs);
  });

  it('cuts a grapheme at a stored run boundary before choosing either face', () => {
    const text = 'a\u0301';
    const runs: StyleRun[] = [
      { length: 1, style: STYLE },
      { length: 1, style: { ...STYLE, fontFamily: 'Second' } },
    ];
    const first = face('Own', 'a');
    const second = face('Second', '\u0301');
    expect(
      ranges(
        fallbackRuns(text, runs, (run) => (run === runs[0] ? first : second), [face('Both', text)]),
      ),
    ).toEqual([
      [1, 'Own'],
      [1, 'Second'],
    ]);
  });
});

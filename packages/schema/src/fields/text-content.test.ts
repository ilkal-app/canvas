import { describe, expect, it } from 'vitest';

import { splitEmojiContent, wholeEmojiContent } from './__fixtures__/split-emoji.js';
import { findRunIssues, findRunsSplittingCharacters, textContentSchema } from './text-content.js';
import type { StyleRun, TextStyle } from './text-style.js';

const BODY: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0.1, 0.1, 0.1, 1],
  weight: 400,
  italic: false,
};
const BOLD: TextStyle = { ...BODY, weight: 700 };

function run(length: number, style: TextStyle = BODY): StyleRun {
  return { length, style };
}

describe('findRunIssues', () => {
  it('accepts runs whose lengths sum to the text length', () => {
    expect(findRunIssues('Hello world', [run(6), run(5, BOLD)])).toEqual([]);
  });

  it('accepts one zero-length run on empty text, which carries the style typing will use', () => {
    expect(findRunIssues('', [run(0, BOLD)])).toEqual([]);
  });

  it('reports an empty run list', () => {
    expect(findRunIssues('', [])).toEqual(['runs must hold at least one run']);
  });

  it('reports lengths that do not sum to the text length, counted in UTF-16 code units', () => {
    expect(findRunIssues('😀', [run(1)])).toEqual([
      'run lengths sum to 1 but the text has 2 UTF-16 code units',
    ]);
    expect(findRunIssues('😀', [run(2)])).toEqual([]);
  });

  it('reports a zero-length run on non-empty text', () => {
    expect(findRunIssues('ab', [run(2), run(0, BOLD)])).toEqual([
      'run 1 has length 0 but only empty text may have a zero-length run',
    ]);
  });

  it('reports adjacent runs with equal styles, which must be merged', () => {
    expect(findRunIssues('ab', [run(1), run(1, { ...BODY })])).toEqual([
      'runs 0 and 1 have equal styles and must be merged',
    ]);
  });

  it('reports a run boundary inside a surrogate pair, such as an emoji split between two runs', () => {
    const { text, runs } = splitEmojiContent();
    expect(findRunIssues(text, runs)).toEqual([
      'run 1 starts inside a surrogate pair; run boundaries must fall between characters',
    ]);
  });

  it('accepts a run boundary before or after an emoji', () => {
    const { text, runs } = wholeEmojiContent();
    expect(findRunIssues(text, runs)).toEqual([]);
    expect(findRunIssues('😀x', [run(2), run(1, BOLD)])).toEqual([]);
  });

  it('reports every split pair, alongside the other invariant issues', () => {
    expect(findRunIssues('😀😀', [run(1), run(2, BOLD), run(2)])).toEqual([
      'run lengths sum to 5 but the text has 4 UTF-16 code units',
      'run 1 starts inside a surrogate pair; run boundaries must fall between characters',
      'run 2 starts inside a surrogate pair; run boundaries must fall between characters',
    ]);
  });
});

describe('findRunsSplittingCharacters', () => {
  it('finds the runs that start inside a surrogate pair, and only those', () => {
    const halves: StyleRun[] = [run(2), run(2, BOLD)];
    expect(findRunsSplittingCharacters('x😀y', halves)).toEqual([1]);
    expect(findRunsSplittingCharacters('x😀y', [run(3), run(1, BOLD)])).toEqual([]);
    expect(findRunsSplittingCharacters('', [run(0)])).toEqual([]);
  });

  it('never mutates the runs it is given', () => {
    const content = splitEmojiContent();
    const runs = Object.freeze(content.runs.map((entry) => Object.freeze({ ...entry })));
    expect(findRunsSplittingCharacters(content.text, runs)).toEqual([1]);
    expect(runs).toEqual(splitEmojiContent().runs);
  });
});

describe('textContentSchema', () => {
  it('accepts well-formed text and runs', () => {
    expect(textContentSchema.safeParse({ text: 'Hi', runs: [run(2)] }).success).toBe(true);
  });

  it('rejects runs that break the invariant, with the issue on the runs path', () => {
    const result = textContentSchema.safeParse({ text: 'Hi', runs: [run(3)] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['runs']]);
  });

  it("rejects a run starting inside a surrogate pair, on that run's path, tagged with its code", () => {
    const result = textContentSchema.safeParse(splitEmojiContent());
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        code: 'custom',
        path: ['runs', 1],
        params: { boardIssueCode: 'run-splits-character' },
      }),
    ]);
    expect(textContentSchema.safeParse(wholeEmojiContent()).success).toBe(true);
  });

  it('rejects a font size outside 4 to 400 world px and a colour channel outside 0 to 1', () => {
    expect(
      textContentSchema.safeParse({ text: 'a', runs: [run(1, { ...BODY, fontSize: 2 })] }).success,
    ).toBe(false);
    expect(
      textContentSchema.safeParse({ text: 'a', runs: [run(1, { ...BODY, color: [2, 0, 0, 1] })] })
        .success,
    ).toBe(false);
  });

  it('rejects a weight between the nine CSS weights and a non-integer run length', () => {
    expect(
      textContentSchema.safeParse({ text: 'a', runs: [run(1, { ...BODY, weight: 450 as 400 })] })
        .success,
    ).toBe(false);
    expect(
      textContentSchema.safeParse({ text: 'a', runs: [run(0.5), run(0.5, BOLD)] }).success,
    ).toBe(false);
  });
});

// Written before the code. CONTRACT: typing inherits a run link only between characters with the same link, while a caret's pending link wins. Deliberately not asserted: glyph layout or browser input events.
import { describe, expect, it } from 'vitest';

import { TEN } from './__fixtures__/text-mode-context.js';
import { createEditorState, insertStyleOf } from './editor-state.js';
import { insertText } from './editor.js';

const LINK = 'https://example.com/guide';
const runs = [
  { length: 2, style: TEN },
  { length: 3, style: { ...TEN, link: LINK } },
  { length: 2, style: TEN },
];

describe('insertion link boundaries', () => {
  it.each([
    [0, undefined],
    [2, undefined],
    [3, LINK],
    [4, LINK],
    [5, undefined],
    [7, undefined],
  ])('uses %s as a caret without extending a link across its edge', (caret, link) => {
    const state = createEditorState('abXYZcd', runs, caret);
    expect(insertStyleOf(state).link).toBe(link);
    const next = insertText(state, 'x');
    const expected = [undefined, undefined, LINK, LINK, LINK, undefined, undefined];
    expected.splice(caret, 0, link);
    expect(
      next.runs.flatMap((run) => Array.from({ length: run.length }, () => run.style.link)),
    ).toEqual(expected);
  });

  it('honours a pending link at an otherwise plain caret without changing existing runs', () => {
    const original = createEditorState('abc', [{ length: 3, style: TEN }], 3);
    const pending = { ...original, pending: { link: LINK } };
    expect(insertStyleOf(pending).link).toBe(LINK);
    expect(pending.runs).toEqual(original.runs);
    const next = insertText(pending, 'x');
    expect(next.text).toBe('abcx');
    expect(next.runs).toEqual([
      { length: 3, style: TEN },
      { length: 1, style: { ...TEN, link: LINK } },
    ]);
  });
});

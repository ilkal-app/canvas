import { describe, expect, it } from 'vitest';

import { monoLayout } from './__fixtures__/mono-layout.js';
import {
  moveHorizontal,
  moveToLineEdge,
  moveToTextEdge,
  moveVertical,
  selectAll,
  selectRange,
  selectWord,
  setCaret,
} from './editor-navigation.js';
import { createEditorState, selectionRange, type EditorState } from './editor-state.js';
import { followDocument } from './editor-sync.js';
import { insertText } from './editor.js';
import { BASE, BOLD, runsOf } from './runs/__fixtures__/text-styles.js';
import { wordRangeAt } from './word-ranges.js';

/**
 * An editor over base-style text.
 *
 * @param text - The text.
 * @param caret - The caret.
 * @param anchor - The anchor; the caret when omitted.
 * @returns The state.
 */
function editorOf(text: string, caret: number, anchor = caret): EditorState {
  return { ...createEditorState(text, runsOf([text.length, BASE])), caret, anchor };
}

describe('editor: caret moves', () => {
  it('moves by code point, never inside a surrogate pair, and clears the pending style', () => {
    const state = { ...editorOf('a😀b', 1), pending: { weight: 700 as const } };
    const right = moveHorizontal(state, 1, 'character', false);
    expect(right).toMatchObject({ caret: 3, anchor: 3, pending: undefined });
    expect(moveHorizontal(right, -1, 'character', false).caret).toBe(1);
    expect(setCaret(state, 2, false).caret).toBe(1);
    expect(setCaret(state, 99, false).caret).toBe(4);
  });

  it.each(['\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', '🇫🇷', 'e\u0301'])(
    'moves and extends across the whole grapheme %s before typing',
    (cluster) => {
      const text = `a${cluster}b`;
      const start = 1;
      const end = start + cluster.length;
      const right = moveHorizontal(editorOf(text, start), 1, 'character', false);
      expect(right).toMatchObject({ caret: end, anchor: end });
      expect(insertText(right, 'X').text).toBe(`a${cluster}Xb`);
      const left = moveHorizontal(editorOf(text, end), -1, 'character', false);
      expect(left).toMatchObject({ caret: start, anchor: start });
      expect(insertText(left, 'X').text).toBe(`aX${cluster}b`);
      for (const [caret, direction] of [
        [start, 1],
        [end, -1],
      ] as const) {
        const selected = moveHorizontal(editorOf(text, caret), direction, 'character', true);
        expect(selectionRange(selected)).toEqual([start, end]);
        expect(insertText(selected, 'X').text).toBe('aXb');
      }
    },
  );

  it('extends with Shift and collapses a selection to its side without it', () => {
    const extended = moveHorizontal(editorOf('abcd', 1), 1, 'character', true);
    expect(selectionRange(extended)).toEqual([1, 2]);
    expect(moveHorizontal(editorOf('abcd', 3, 1), -1, 'character', false).caret).toBe(1);
    expect(moveHorizontal(editorOf('abcd', 3, 1), 1, 'character', false).caret).toBe(3);
  });

  it('moves by word with mod', () => {
    const state = editorOf('one two  three', 5);
    expect(moveHorizontal(state, 1, 'word', false).caret).toBe(7);
    expect(moveHorizontal(state, -1, 'word', false).caret).toBe(4);
    expect(moveHorizontal(editorOf('one two', 7), 1, 'word', true).caret).toBe(7);
  });

  it('goes to the line edges, the visual end before a wrap space', () => {
    // 10 px mono at 0.6 em is 6 px a character; 30 px holds "abcd " on the first line.
    const layout = monoLayout('abcd efgh', runsOf([9, { ...BASE, fontSize: 10 }]), 30);
    const state = editorOf('abcd efgh', 2);
    expect(moveToLineEdge(state, 1, false, layout).caret).toBe(4);
    expect(moveToLineEdge(editorOf('abcd efgh', 7), -1, false, layout).caret).toBe(5);
    expect(moveToTextEdge(state, 1, true)).toMatchObject({ caret: 9, anchor: 2 });
    expect(moveToTextEdge(state, -1, false).caret).toBe(0);
  });

  it('moves up and down a line at the caret x, to the ends past the first and last', () => {
    const layout = monoLayout('abc\ndefg\nhi', runsOf([11, { ...BASE, fontSize: 10 }]));
    const state = editorOf('abc\ndefg\nhi', 6);
    expect(moveVertical(state, -1, false, layout).caret).toBe(2);
    expect(moveVertical(state, 1, false, layout).caret).toBe(11);
    expect(moveVertical(editorOf('abc\ndefg\nhi', 1), -1, false, layout).caret).toBe(0);
    expect(moveVertical(editorOf('abc\ndefg\nhi', 10), 1, true, layout).caret).toBe(11);
  });
});

describe('editor: selections', () => {
  it('selects a word, a run of other characters, never across a newline', () => {
    expect(wordRangeAt('hello, world', 2)).toEqual([0, 5]);
    expect(wordRangeAt('hello, world', 5)).toEqual([5, 7]);
    expect(wordRangeAt('ab\ncd', 3)).toEqual([3, 5]);
    expect(wordRangeAt('abc', 3)).toEqual([0, 3]);
    expect(wordRangeAt('', 0)).toEqual([0, 0]);
    expect(selectionRange(selectWord(editorOf('hi 😀😀 yo', 3), 4))).toEqual([2, 8]);
  });

  it('selects all and a range, snapped between code points', () => {
    expect(selectionRange(selectAll(editorOf('abc', 1)))).toEqual([0, 3]);
    expect(selectRange(editorOf('a😀', 0), 2, 0)).toMatchObject({ anchor: 1, caret: 0 });
  });
});

describe('followDocument', () => {
  it('keeps the caret with its text when a collaborator types before or after it', () => {
    const state = editorOf('hello world', 5, 3);
    expect(followDocument(state, 'oh hello world', state.runs)).toMatchObject({
      caret: 8,
      anchor: 6,
    });
    expect(followDocument(state, 'hello world!', state.runs)).toMatchObject({
      caret: 5,
      anchor: 3,
    });
  });

  it('moves a caret inside a replaced range to its end, and keeps the pending style only for a restyle', () => {
    const pending = { ...editorOf('abcdef', 3), pending: { weight: 700 as const } };
    const replaced = followDocument(pending, 'abXYZef', runsOf([7, BASE]));
    expect(replaced).toMatchObject({ caret: 5, pending: undefined });
    const restyled = followDocument(pending, 'abcdef', runsOf([3, BOLD], [3, BASE]));
    expect(restyled).toMatchObject({ caret: 3, pending: { weight: 700 } });
    expect(followDocument(pending, pending.text, pending.runs)).toBe(pending);
  });

  it('puts the caret at the end of what the user’s own undo or redo changed', () => {
    const state = editorOf('one ', 4);
    expect(followDocument(state, 'one two ', runsOf([8, BASE]), true)).toMatchObject({
      caret: 8,
      anchor: 8,
    });
    expect(followDocument(editorOf('one two ', 8), 'one ', runsOf([4, BASE]), true)).toMatchObject({
      caret: 4,
    });
  });
});

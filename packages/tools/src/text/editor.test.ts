import { describe, expect, it } from 'vitest';

import { findRunIssues } from '@canvas/schema';

import { setCaret } from './editor-navigation.js';
import {
  createEditorState,
  insertStyleOf,
  selectedContent,
  selectionRange,
  type EditorState,
} from './editor-state.js';
import {
  beginComposition,
  deleteBackward,
  deleteForward,
  insertStyled,
  insertText,
  setStyle,
} from './editor.js';
import { BASE, BOLD, LARGE, RED, runsOf } from './runs/__fixtures__/text-styles.js';

/**
 * An editor over text with the caret and anchor where given.
 *
 * @param text - The text.
 * @param runs - Its runs.
 * @param caret - The caret.
 * @param anchor - The anchor; the caret when omitted.
 * @returns The state.
 */
function editorOf(
  text: string,
  runs = runsOf([text.length, BASE]),
  caret = text.length,
  anchor = caret,
): EditorState {
  return { ...createEditorState(text, runs), caret, anchor };
}

describe('editor: typing', () => {
  it('inserts in the style of the character before the caret and moves the caret past it', () => {
    const state = insertText(editorOf('ab', runsOf([1, BASE], [1, BOLD]), 2), 'cd');
    expect(state).toMatchObject({ text: 'abcd', caret: 4, anchor: 4 });
    expect(state.runs).toEqual(runsOf([1, BASE], [3, BOLD]));
  });

  it('replaces a selection in the style of its first character', () => {
    const state = insertText(editorOf('abcd', runsOf([2, BASE], [2, BOLD]), 1, 3), 'X');
    expect(state.text).toBe('aXd');
    expect(state.runs).toEqual(runsOf([2, BASE], [1, BOLD]));
  });

  it('takes the following character’s style at the start of a line', () => {
    const lineStart = editorOf('a\nbc', runsOf([2, BASE], [2, RED]), 2);
    expect(insertStyleOf(lineStart)).toBe(RED);
    expect(insertStyleOf(editorOf('bc', runsOf([2, RED]), 0))).toBe(RED);
    // A caret at the end of a line keeps the character before it.
    expect(insertStyleOf(editorOf('a\nbc', runsOf([2, BASE], [2, RED]), 1))).toBe(BASE);
  });

  it('uses a pending style for the next insert, keeps it through typing, and a caret move clears it', () => {
    const pending = setStyle(editorOf('ab'), { weight: 700 });
    expect(pending.runs).toEqual(runsOf([2, BASE]));
    expect(insertStyleOf(pending)).toEqual(BOLD);
    const typed = insertText(insertText(pending, 'c'), 'd');
    expect(typed.runs).toEqual(runsOf([2, BASE], [2, BOLD]));
    expect(typed.pending).toEqual({ weight: 700 });
    expect(setCaret(typed, 1, false).pending).toBeUndefined();
    expect(deleteBackward(typed).pending).toBeUndefined();
  });

  it('restyles a selection and keeps it selected', () => {
    const state = setStyle(editorOf('abcd', runsOf([4, BASE]), 3, 1), { fontSize: 32 });
    expect(state.runs).toEqual(runsOf([1, BASE], [2, LARGE], [1, BASE]));
    expect(selectionRange(state)).toEqual([1, 3]);
  });
});

describe('editor: deleting', () => {
  it('deletes a whole code point backward and forward, across a run boundary', () => {
    const runs = runsOf([1, BASE], [2, BOLD], [1, BASE]);
    const back = deleteBackward(editorOf('a😀b', runs, 3));
    expect(back).toMatchObject({ text: 'ab', caret: 1 });
    expect(findRunIssues(back.text, back.runs)).toEqual([]);
    const forward = deleteForward(editorOf('a😀b', runs, 1));
    expect(forward.text).toBe('ab');
    expect(forward.runs).toEqual(runsOf([2, BASE]));
  });

  it('deletes a whole grapheme cluster: an emoji sequence, a flag, a letter with its mark', () => {
    for (const cluster of [
      '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
      '\u{1F1EB}\u{1F1F7}',
      'e\u0301',
    ]) {
      const text = `a${cluster}b`;
      const back = deleteBackward(editorOf(text, undefined, 1 + cluster.length));
      expect(back).toMatchObject({ text: 'ab', caret: 1 });
      expect(deleteForward(editorOf(text, undefined, 1))).toMatchObject({ text: 'ab', caret: 1 });
    }
  });

  it('deletes a selection either way, and does nothing at the ends', () => {
    expect(deleteBackward(editorOf('abc', undefined, 0, 2)).text).toBe('c');
    expect(deleteForward(editorOf('abc', undefined, 2, 0)).text).toBe('c');
    const start = editorOf('abc', undefined, 0);
    expect(deleteBackward(start)).toBe(start);
    const end = editorOf('abc');
    expect(deleteForward(end)).toBe(end);
  });

  it('keeps the deleted style for text emptied by a delete', () => {
    const emptied = deleteBackward(editorOf('ab', runsOf([2, RED]), 0, 2));
    expect(emptied.runs).toEqual(runsOf([0, RED]));
  });
});

describe('editor: styled paste and composition', () => {
  it('pastes styled runs over the selection, caret after them', () => {
    const state = insertStyled(editorOf('abcd', runsOf([4, BASE]), 1, 3), {
      text: 'XY',
      runs: runsOf([1, RED], [1, BOLD]),
    });
    expect(state).toMatchObject({ text: 'aXYd', caret: 3, anchor: 3 });
    expect(state.runs).toEqual(runsOf([1, BASE], [1, RED], [1, BOLD], [1, BASE]));
  });

  it('gives the selected content with its runs, none for a collapsed caret', () => {
    const state = editorOf('abcd', runsOf([2, BASE], [2, BOLD]), 3, 1);
    expect(selectedContent(state)).toEqual({ text: 'bc', runs: runsOf([1, BASE], [1, BOLD]) });
    expect(selectedContent(editorOf('ab'))).toBeUndefined();
  });

  it('leaves a collapsed caret alone when a composition begins', () => {
    const state = editorOf('ab');
    expect(beginComposition(state)).toBe(state);
  });

  it('deletes a selection when a composition begins over it, pinning its style as pending', () => {
    const state = beginComposition(editorOf('ab', runsOf([1, BASE], [1, RED]), 1, 2));
    expect(state).toMatchObject({ text: 'a', caret: 1, pending: RED });
    const committed = insertText(state, 'か');
    expect(committed.runs).toEqual(runsOf([1, BASE], [1, RED]));
  });
});

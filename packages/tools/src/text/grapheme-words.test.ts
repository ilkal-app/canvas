import { describe, expect, it } from 'vitest';

import { moveHorizontal, selectWord } from './editor-navigation.js';
import { createEditorState, selectionRange } from './editor-state.js';
import { BASE, runsOf } from './runs/__fixtures__/text-styles.js';
import { wordEndAfter, wordRangeAt, wordStartBefore } from './word-ranges.js';

describe('word boundaries beside combining marks', () => {
  it('makes forward word progress over the complete last grapheme', () => {
    const text = 'e\u0301 next';
    const state = createEditorState(text, runsOf([text.length, BASE]), 0);
    expect(wordEndAfter(text, 0)).toBe(2);
    expect(moveHorizontal(state, 1, 'word', false).caret).toBe(2);
    expect(wordStartBefore(text, 2)).toBe(0);
  });

  it('selects a whole accented grapheme rather than an empty partial word', () => {
    const text = 'e\u0301 next';
    const state = createEditorState(text, runsOf([text.length, BASE]), 0);
    expect(wordRangeAt(text, 0)).toEqual([0, 2]);
    expect(selectionRange(selectWord(state, 0))).toEqual([0, 2]);
    // The mark is part of the word 'é', not of the space after it.
    expect(wordRangeAt(text, 1)).toEqual([0, 2]);
  });
});

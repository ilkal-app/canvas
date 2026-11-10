import { describe, expect, it } from 'vitest';

import { moveHorizontal, selectWord } from './editor-navigation.js';
import { createEditorState, selectionRange } from './editor-state.js';
import { deleteBackward } from './editor.js';
import { BASE, runsOf } from './runs/__fixtures__/text-styles.js';

describe('locale-aware editor words', () => {
  it('selects the second Thai word using its style run language', () => {
    const text = 'สวัสดีครับ';
    const state = createEditorState(text, runsOf([text.length, { ...BASE, lang: 'th' }]), 7);
    expect(selectionRange(selectWord(state, 7))).toEqual([6, 10]);
  });

  it('moves right by one Thai word using the caret run language', () => {
    const text = 'สวัสดีครับ';
    const state = createEditorState(text, runsOf([text.length, { ...BASE, lang: 'th' }]), 0);
    expect(moveHorizontal(state, 1, 'word', false)).toMatchObject({ caret: 6, anchor: 6 });
  });

  it('moves in both directions by Devanagari words', () => {
    const text = 'नमस्ते दुनिया';
    const runs = runsOf([text.length, { ...BASE, lang: 'hi' }]);
    expect(moveHorizontal(createEditorState(text, runs, 0), 1, 'word', false).caret).toBe(6);
    expect(moveHorizontal(createEditorState(text, runs), -1, 'word', false).caret).toBe(7);
  });

  it('uses the language at the requested selection index across style runs', () => {
    const text = 'hello สวัสดีครับ';
    const runs = runsOf([6, BASE], [10, { ...BASE, lang: 'th' }]);
    expect(selectionRange(selectWord(createEditorState(text, runs, 0), 13))).toEqual([12, 16]);
  });

  it('deletes Devanagari conjunct graphemes from the end one unit at a time', () => {
    const text = 'क्षत्रिय';
    const runs = runsOf([text.length, { ...BASE, lang: 'hi' }]);
    const first = deleteBackward(createEditorState(text, runs));
    expect(first).toMatchObject({ text: 'क्षत्रि', caret: 7, anchor: 7 });
    const second = deleteBackward(first);
    expect(second).toMatchObject({ text: 'क्ष', caret: 3, anchor: 3 });
    expect(deleteBackward(second)).toMatchObject({ text: '', caret: 0, anchor: 0 });
  });
});

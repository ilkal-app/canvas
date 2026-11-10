import { describe, expect, it } from 'vitest';

import { createEditorState } from './editor-state.js';
import { selectionListOf, setList } from './editor.js';
import { BASE, runsOf } from './runs/__fixtures__/text-styles.js';

/**
 * An editor over three paragraphs with a selection.
 *
 * @param anchor - The selection's fixed end.
 * @param caret - Its moving end.
 * @returns The state.
 */
function selected(anchor: number, caret: number) {
  return {
    ...createEditorState('a\nb\nc', runsOf([5, BASE]), caret, [
      { list: 'bullet', level: 2 },
      {},
      { list: 'numbered' },
    ]),
    anchor,
  };
}

describe('the list menu’s commands', () => {
  it('sets a list over the touched paragraphs, keeping levels, or none', () => {
    const state = selected(0, 3);
    expect(setList(state, 'numbered').paragraphs).toEqual([
      { list: 'numbered', level: 2 },
      { list: 'numbered' },
      { list: 'numbered' },
    ]);
    expect(setList(state, null).paragraphs).toEqual([{}, {}, { list: 'numbered' }]);
    const plain = selected(2, 2);
    expect(setList(plain, null)).toBe(plain);
  });

  it('reads the list the touched paragraphs share: bullet, numbered, none or mixed', () => {
    expect(selectionListOf(selected(0, 0))).toBe('bullet');
    expect(selectionListOf(selected(4, 4))).toBe('numbered');
    expect(selectionListOf(selected(2, 2))).toBe('none');
    expect(selectionListOf(selected(0, 5))).toBe('mixed');
  });
});

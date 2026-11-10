import { describe, expect, it } from 'vitest';

import { findRunIssues, paragraphCount, type ParagraphStyle } from '@canvas/schema';

import { createEditorState, type EditorState } from './editor-state.js';
import * as editor from './editor.js';
import { applyListTrigger, changeListLevel, insertParagraphBreak, toggleList } from './editor.js';
import { BASE, runsOf } from './runs/__fixtures__/text-styles.js';

const paragraphsOf = (state: EditorState): readonly ParagraphStyle[] => state.paragraphs;
const stateOf = (
  text: string,
  caret: number,
  paragraphs?: readonly ParagraphStyle[],
): EditorState => createEditorState(text, runsOf([text.length, BASE]), caret, paragraphs);

describe('editor paragraphs and lists', () => {
  it('starts with one plain style per paragraph and copies it across inserted breaks', () => {
    const initial = stateOf('ab\ncd', 1, [{ list: 'bullet' }, {}]);
    expect(paragraphsOf(initial)).toEqual([{ list: 'bullet' }, {}]);
    const next = editor.insertText(initial, '\n\nx');
    expect(paragraphsOf(next)).toEqual([
      { list: 'bullet' },
      { list: 'bullet' },
      { list: 'bullet' },
      {},
    ]);
    expect(paragraphsOf(next)).toHaveLength(paragraphCount(next.text));
    expect(paragraphsOf(stateOf('a\nb', 0))).toEqual([{}, {}]);
  });

  it('keeps the first paragraph style when joining or replacing across paragraphs', () => {
    const styles: ParagraphStyle[] = [{ list: 'numbered' }, { list: 'bullet' }];
    const back = editor.deleteBackward(stateOf('a\nb', 2, [{ list: 'numbered' }, {}]));
    const forward = editor.deleteForward(stateOf('a\nb', 1, styles));
    for (const next of [back, forward]) {
      expect(next.text).toBe('ab');
      expect(paragraphsOf(next)).toEqual([{ list: 'numbered' }]);
    }
    const selected = { ...stateOf('a\nb', 0, styles), anchor: 3 };
    expect(paragraphsOf(editor.insertText(selected, 'x'))).toEqual([{ list: 'numbered' }]);
  });

  it('turns a list paragraph plain on Backspace at its start without moving the caret', () => {
    const before = stateOf('a\nb', 2, [{}, { list: 'bullet' }]);
    const after = editor.deleteBackward(before);
    expect(after).toMatchObject({ text: before.text, runs: before.runs, caret: 2, anchor: 2 });
    expect(paragraphsOf(after)).toEqual([{}, {}]);
  });

  it('toggles touched paragraphs and preserves existing list levels', () => {
    const before = {
      ...stateOf('a\nb\nc', 1, [{ list: 'bullet', level: 2 }, {}, { list: 'numbered' }]),
      anchor: 4,
    };
    const changed = toggleList(before, 'bullet');
    expect(paragraphsOf(changed)).toEqual([
      { list: 'bullet', level: 2 },
      { list: 'bullet' },
      { list: 'numbered' },
    ]);
    expect(toggleList(changed, 'bullet')).toMatchObject({
      text: before.text,
      runs: before.runs,
      caret: before.caret,
      anchor: before.anchor,
    });
    expect(paragraphsOf(toggleList(changed, 'bullet'))).toEqual([{}, {}, { list: 'numbered' }]);
  });

  it('clamps level changes and leaves plain paragraphs alone', () => {
    expect(changeListLevel(stateOf('x', 0), 1)).toBeUndefined();
    const before = { ...stateOf('a\nb', 0, [{ list: 'bullet', level: 3 }, {}]), anchor: 3 };
    expect(paragraphsOf(changeListLevel(before, 1) ?? before)).toEqual([
      { list: 'bullet', level: 3 },
      {},
    ]);
    expect(
      paragraphsOf(changeListLevel(stateOf('a', 0, [{ list: 'bullet', level: 1 }]), -1) ?? before),
    ).toEqual([{ list: 'bullet' }]);
  });

  it.each([
    ['- ', 'bullet'],
    ['* ', 'bullet'],
    ['1. ', 'numbered'],
  ] as const)('converts %s into a %s list', (text, kind) => {
    const next = applyListTrigger(stateOf(text, text.length));
    expect(next?.text).toBe('');
    expect(next?.caret).toBe(0);
    if (next === undefined) throw new Error('List trigger did not apply');
    expect(paragraphsOf(next)).toEqual([{ list: kind }]);
    expect(findRunIssues(next.text, next.runs)).toEqual([]);
  });

  it('rejects partial triggers and exits an empty list one level at a time on Enter', () => {
    for (const text of ['a- ', '2. '])
      expect(applyListTrigger(stateOf(text, text.length))).toBeUndefined();
    expect(applyListTrigger(stateOf('- ', 2, [{ list: 'bullet' }]))).toBeUndefined();
    const nested = stateOf('', 0, [{ list: 'bullet', level: 1 }]);
    expect(paragraphsOf(insertParagraphBreak(nested))).toEqual([{ list: 'bullet' }]);
    expect(paragraphsOf(insertParagraphBreak(stateOf('', 0, [{ list: 'bullet' }])))).toEqual([{}]);
    expect(insertParagraphBreak(stateOf('a', 1, [{ list: 'bullet' }])).text).toBe('a\n');
  });
});

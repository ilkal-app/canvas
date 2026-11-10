import { describe, expect, it } from 'vitest';

import { monoLayout } from './__fixtures__/mono-layout.js';
import { createTextModeContext, tenPointText } from './__fixtures__/text-mode-context.js';
import { moveToLineEdge, moveVertical, selectRange, setCaret } from './editor-navigation.js';
import { createEditorState } from './editor-state.js';
import { followDocument } from './editor-sync.js';
import { insertStyled, insertText } from './editor.js';
import { nextGraphemeIndex, previousGraphemeIndex } from './grapheme-steps.js';
import { BASE, runsOf } from './runs/__fixtures__/text-styles.js';
import { TextEditingSession } from './text-session.js';

const FAMILY = '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}';
const CLUSTERS = [FAMILY, '\u{1f1eb}\u{1f1f7}', 'e\u0301', `e${'\u0301'.repeat(100)}`];

/**
 * Creates an editor with valid runs over the supplied text.
 *
 * @param text - The content.
 * @param caret - The requested position.
 * @returns The editor state.
 */
function editor(text: string, caret = 0) {
  return createEditorState(text, runsOf([text.length, BASE]), caret);
}

describe('grapheme caret placement', () => {
  it.each(CLUSTERS)('snaps every interior offset of %s to a cluster boundary', (cluster) => {
    const text = `a${cluster}b`;
    for (let index = 2; index < 1 + cluster.length; index += 1) {
      expect(setCaret(editor(text), index, false).caret).toBe(1);
      expect(selectRange(editor(text), index, index)).toMatchObject({ caret: 1, anchor: 1 });
      expect(editor(text, index).caret).toBe(1);
    }
  });

  it('moves vertically without landing between a base and its mark', () => {
    const text = 'abcd\nAe\u0301B\nabcd';
    const layout = monoLayout(text, runsOf([text.length, { ...BASE, fontSize: 10 }]));
    expect(moveVertical(editor(text, 2), 1, false, layout).caret).toBe(6);
    expect(moveVertical(editor(text, 12), -1, true, layout)).toMatchObject({
      caret: 6,
      anchor: 12,
    });
  });

  it('snaps Home and End when a visual wrap lies inside a cluster', () => {
    const text = 'Ae\u0301B';
    const layout = monoLayout(text, runsOf([text.length, { ...BASE, fontSize: 10 }]), 12);
    expect(moveToLineEdge(editor(text, 0), 1, false, layout).caret).toBe(1);
    expect(moveToLineEdge(editor(text, 4), -1, false, layout).caret).toBe(1);
  });

  it('snaps a clicked point before typing rather than splitting its cluster', () => {
    const object = tenPointText('t', 'Ae\u0301B');
    const { context } = createTextModeContext([object]);
    const session = new TextEditingSession(context, object, 0);
    session.placeCaret({ x: object.x + 12, y: object.y + 5 }, false);
    expect(session.editor.caret).toBe(1);
  });

  it('keeps after-insert and paste carets after the cluster newly formed with following text', () => {
    const state = editor('\u0301x');
    expect(insertText(state, 'e')).toMatchObject({ text: 'e\u0301x', caret: 2, anchor: 2 });
    expect(insertStyled(state, { text: 'e', runs: runsOf([1, BASE]) })).toMatchObject({ caret: 2 });
  });

  it('snaps positions remapped by a remote change or own undo', () => {
    const state = editor('ex', 1);
    const text = 'e\u0301x';
    expect(followDocument(state, text, runsOf([text.length, BASE])).caret).toBe(0);
    expect(
      followDocument(editor('X\u0301x', 0), text, runsOf([text.length, BASE]), true).caret,
    ).toBe(2);
  });

  it('steps over a cluster longer than the previous finite segmentation window', () => {
    const cluster = CLUSTERS[3] ?? '';
    const text = `a${cluster}b`;
    expect(nextGraphemeIndex(text, 1)).toBe(1 + cluster.length);
    expect(previousGraphemeIndex(text, 1 + cluster.length)).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';

import type { ObjectId, TextObject } from '@canvas/schema';

import { createTextModeContext, TEN, tenPointText } from './__fixtures__/text-mode-context.js';
import { deleteBy, replaceText } from './session-edits.js';
import { TextEditingSession } from './text-session.js';

/**
 * A session over one text object, its caret at a position.
 *
 * @param text - The object's text; 10 px text, 6 px a character, wrapping at 60 px (ten).
 * @param caret - Where the caret is.
 * @returns The session, the store's copy of the object and the undo grouping record.
 */
function setUp(text: string, caret: number) {
  const object = tenPointText('t', text, { autoWidth: false, width: 60 });
  const { store, context, record } = createTextModeContext([object]);
  const session = new TextEditingSession(context, object, caret);
  const stored = (): TextObject => store.get('t' as ObjectId) as TextObject;
  return { session, stored, record };
}

describe('deleteBy', () => {
  it('deletes a character, a word or to the line edge, backward and forward', () => {
    const { session, stored } = setUp('one two three', 7);
    deleteBy(session, 'word', -1);
    expect(stored().text).toBe('one  three');
    deleteBy(session, 'word', 1);
    expect(stored().text).toBe('one ');
    deleteBy(session, 'character', -1);
    expect(stored().text).toBe('one');
    deleteBy(session, 'lineEdge', -1);
    expect(stored().text).toBe('');
  });

  it('deletes to the edge of the laid-out line, not the text', () => {
    // Wraps at 60 px: "alpha beta " on the first line (its space hangs), "gamma" on the second.
    const { session, stored } = setUp('alpha beta gamma', 13);
    deleteBy(session, 'lineEdge', -1);
    expect(stored().text).toBe('alpha beta mma');
    deleteBy(session, 'lineEdge', 1);
    expect(stored().text).toBe('alpha beta ');
  });

  it('deletes the selection whatever the unit', () => {
    const { session, stored } = setUp('abcdef', 0);
    session.selectAll();
    deleteBy(session, 'word', 1);
    expect(stored().text).toBe('');
  });

  it('writes nothing at the text’s edge', () => {
    const { session, stored, record } = setUp('ab', 0);
    deleteBy(session, 'word', -1);
    deleteBy(session, 'lineEdge', -1);
    expect(stored().text).toBe('ab');
    expect(record.capture).toEqual([]);
  });
});

describe('replaceText', () => {
  it('replaces a range in its insert style, a space ending the typing step', () => {
    const { session, stored, record } = setUp('cat', 3);
    replaceText(session, 0, 3, 'dog');
    expect(stored()).toMatchObject({ text: 'dog', runs: [{ length: 3, style: TEN }] });
    replaceText(session, 3, 3, ' ');
    replaceText(session, 1, 1, '');
    expect(stored().text).toBe('dog ');
    const id = String(session.sessionId);
    expect(record.capture).toEqual([`typing:${id}:false`, `typing:${id}:true`]);
  });

  it('keeps the pending style when it types at the caret', () => {
    const { session, stored } = setUp('ab', 2);
    session.setStyle({ italic: true });
    replaceText(session, 2, 2, 'c');
    expect(stored().runs.at(-1)).toEqual({ length: 1, style: { ...TEN, italic: true } });
  });
});

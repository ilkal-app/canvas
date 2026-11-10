// Undo and redo of the sticky tool on the engine's document side, with the user's real
// history and the typing policy (__fixtures__/text-document.ts): creating a note is one step,
// its typing words are steps of their own, and an empty note ended with Escape is kept as one
// step. In Chrome: tooling/scenario/specs/tools/sticky-edit.spec.ts.
import { describe, expect, it } from 'vitest';

import type { ObjectId, StickyObject } from '@canvas/schema';

import { onBoard, setUpTextDocument as setUp } from './__fixtures__/text-document.js';

const NOTE = 'text-1' as ObjectId;

/**
 * The document side with a note made by the sticky tool's click, being edited.
 *
 * @returns The fixture and a reader of the note.
 */
function withNewNote() {
  const fixture = setUp();
  fixture.document.setActiveTool('sticky');
  fixture.press('pointerDown', 600, 400);
  fixture.press('pointerUp', 600, 400);
  const note = (): StickyObject | undefined => {
    const object = fixture.store.get(NOTE);
    return object?.type === 'sticky' ? object : undefined;
  };
  return { ...fixture, note };
}

describe('the sticky tool with undo and redo', () => {
  it('undoes the creation of a note in one step, ending the edit, and redoes it', () => {
    const { document, history, note, store } = withNewNote();
    expect(note()).toMatchObject({ text: '', width: 200, height: 200 });
    expect(document.tools.text.session()?.id).toBe(NOTE);
    history.undo();
    expect(note()).toBeUndefined();
    expect(document.tools.text.session()).toBeUndefined();
    expect(history.canUndo()).toBe(false);
    history.redo();
    // Drawn on a demo section, the note joins it (item 9): where it was drawn on the board.
    expect(note()).toMatchObject({ text: '', width: 200, height: 200 });
    expect(onBoard(store, note())).toEqual([500, 300]);
  });

  it('undoes typing into a new note first, then the note itself', () => {
    const { document, history, note } = withNewNote();
    for (const character of 'Hi') document.tools.text.session()?.type(character);
    document.tools.text.policy.endStep();
    expect(note()?.text).toBe('Hi');
    history.undo();
    expect(note()).toMatchObject({ text: '', height: 200 });
    history.undo();
    expect(note()).toBeUndefined();
    expect(history.canUndo()).toBe(false);
    history.redo();
    history.redo();
    expect(note()?.text).toBe('Hi');
  });

  it('keeps an empty note ended with Escape, and one undo removes it', () => {
    const { document, history, note } = withNewNote();
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    expect(document.tools.text.session()).toBeUndefined();
    expect(note()).toMatchObject({ text: '' });
    history.undo();
    expect(note()).toBeUndefined();
    expect(history.canUndo()).toBe(false);
  });
});

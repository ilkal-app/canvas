import { describe, expect, it } from 'vitest';

import type { ObjectId, TextObject } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';

import {
  createTextModeContext,
  TEN,
  tenPointNote,
  tenPointText,
} from './__fixtures__/text-mode-context.js';
import { copySelection, cutSelection, pasteInto } from './session-clipboard.js';
import { TextMode } from './text-mode.js';
import { LOCKED_WHILE_EDITING_NOTICE } from './text-session.js';

/**
 * A primary-button input at a world point, the camera at the origin at 100%.
 *
 * @param kind - Down, move or up.
 * @param x - World x, and CSS px.
 * @param y - World y.
 * @param options - Shift and the time.
 * @param options.isShiftPressed - Whether Shift is held.
 * @param options.timeStamp - When, ms.
 * @returns The input.
 */
function at(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  x: number,
  y: number,
  options: { readonly isShiftPressed?: boolean; readonly timeStamp?: number } = {},
): ToolPointerInput {
  return {
    kind,
    screen: { x, y },
    world: { x, y },
    isShiftPressed: options.isShiftPressed ?? false,
    isModPressed: false,
    zoom: 1,
    ...(options.timeStamp === undefined ? {} : { timeStamp: options.timeStamp }),
  };
}

/**
 * Reads a text object from the store.
 *
 * @param store - The store.
 * @param store.get - Reads an object.
 * @param id - The id.
 * @returns The text object.
 * @throws {Error} When it is not a text object.
 */
function textIn(store: { get: (id: ObjectId) => unknown }, id: string): TextObject {
  const object = store.get(id as ObjectId) as TextObject | undefined;
  if (object?.type !== 'text') throw new Error(`${id} is not a text object`);
  return object;
}

describe('TextMode: sticky notes', () => {
  it("edits a sticky note's text from a click with the text tool, keeping the note", () => {
    const { store, context } = createTextModeContext([tenPointNote('n', '')]);
    const mode = new TextMode(context, { kind: 'create' });
    mode.onPointer(at('pointerDown', 100, 100));
    mode.onPointer(at('pointerUp', 100, 100));
    expect(mode.session?.id).toBe('n');
    mode.session?.type('Hi');
    expect(store.get('n' as ObjectId)).toMatchObject({ text: 'Hi', height: 200 });
    mode.exit();
    expect(store.read().objects.size).toBe(1);
  });

  it('edits an activated sticky note, its whole text selected when entered by Enter', () => {
    const { context } = createTextModeContext([tenPointNote('n', 'abc')]);
    const mode = new TextMode(context, { kind: 'edit', id: 'n' as ObjectId });
    expect(mode.session?.editor).toMatchObject({ anchor: 0, caret: 3 });
  });
});

describe('TextMode: creating', () => {
  it('creates an auto-width box at a click with its first character, writing each keystroke with its size', () => {
    const { store, context, record } = createTextModeContext();
    const mode = new TextMode(context, { kind: 'create' });
    expect(mode.onPointer(at('pointerDown', 40, 50))).toEqual({ isDone: false });
    mode.onPointer(at('pointerUp', 41, 50));
    // A draft: the caret and the box show, the document holds nothing yet.
    expect(store.read().objects.size).toBe(0);
    expect(mode.session?.object()).toMatchObject({ x: 40, y: 50, autoWidth: true, text: '' });
    expect(mode.overlay().toolRects?.length).toBeGreaterThan(0);
    mode.session?.type('H');
    expect(textIn(store, 'new-1')).toMatchObject({ x: 40, y: 50, text: 'H', width: 6 });
    mode.session?.type('i');
    expect(textIn(store, 'new-1')).toMatchObject({ text: 'Hi', width: 12, height: 12.5 });
    const typing = `typing:${String(mode.session?.sessionId)}:false`;
    expect(record.capture).toEqual([typing, typing]);
  });

  it('creates a fixed-width box as wide as a drag', () => {
    const { store, context } = createTextModeContext();
    const mode = new TextMode(context, { kind: 'create' });
    mode.onPointer(at('pointerDown', 100, 10));
    mode.onPointer(at('pointerMove', 60, 12));
    expect(mode.overlay().toolRects).toHaveLength(1);
    mode.onPointer(at('pointerUp', 20, 12));
    mode.session?.type('a');
    expect(textIn(store, 'new-1')).toMatchObject({ x: 20, width: 80, autoWidth: false });
  });

  it('leaves a secondary click and a held finger to the select tool', () => {
    const { store, context, record } = createTextModeContext();
    const mode = new TextMode(context, { kind: 'create' });
    const before = record.changes;
    const secondary: ToolPointerInput = {
      kind: 'contextPress',
      screen: { x: 5, y: 5 },
      world: { x: 5, y: 5 },
      isShiftPressed: false,
      isModPressed: false,
      zoom: 1,
    };
    expect(mode.onPointer(secondary)).toEqual({ isDone: false });
    expect(
      mode.onPointer({ kind: 'hold', timeStamp: 500, screen: { x: 5, y: 5 }, zoom: 1 }),
    ).toEqual({ isDone: false });
    expect(record.changes).toBe(before);
    expect(store.read().objects.size).toBe(0);
  });

  it('drops a press the pointer was taken from, and creates nothing on its release', () => {
    const { store, context } = createTextModeContext();
    const mode = new TextMode(context, { kind: 'create' });
    mode.onPointer(at('pointerDown', 10, 10));
    expect(mode.onPointer({ kind: 'pointerCancel' })).toEqual({ isDone: false });
    mode.onPointer(at('pointerUp', 10, 10));
    expect(store.read().objects.size).toBe(0);
  });

  it('redraws for a new zoom only', () => {
    const { context, record } = createTextModeContext();
    const mode = new TextMode(context, { kind: 'create' });
    const before = record.changes;
    mode.onZoom(1);
    expect(record.changes).toBe(before);
    mode.onZoom(2);
    expect(record.changes).toBe(before + 1);
  });

  it('writes nothing for a box ended empty, and keeps one with text', () => {
    const { store, context, record } = createTextModeContext();
    const changes: unknown[] = [];
    const stop = store.subscribe((change) => changes.push(change));
    const mode = new TextMode(context, { kind: 'create' });
    mode.onPointer(at('pointerDown', 0, 0));
    mode.onPointer(at('pointerUp', 0, 0));
    mode.onKey({ kind: 'escape' });
    mode.exit();
    stop();
    expect(changes).toEqual([]);
    expect(record.capture).toEqual(['endStep']);
    expect(record.selected).toEqual([]);
    const second = new TextMode(context, { kind: 'create' });
    second.onPointer(at('pointerDown', 0, 0));
    second.onPointer(at('pointerUp', 0, 0));
    second.session?.type('x');
    second.exit();
    expect(textIn(store, 'new-2').text).toBe('x');
  });

  it('edits existing text a press lands on instead of creating', () => {
    const { store, context } = createTextModeContext([tenPointText('t', 'hello')]);
    const mode = new TextMode(context, { kind: 'create' });
    mode.onPointer(at('pointerDown', 13, 5));
    mode.onPointer(at('pointerUp', 13, 5));
    expect(mode.session?.editor.caret).toBe(2);
    expect(store.read().objects.size).toBe(1);
  });
});

describe('TextMode: editing', () => {
  it('moves the caret by click, extends with Shift and by drag, selects a word on a double-click', () => {
    const { context } = createTextModeContext([tenPointText('t', 'one two')]);
    const mode = new TextMode(context, {
      kind: 'edit',
      id: 't' as ObjectId,
      world: { x: 1, y: 5 },
    });
    expect(mode.session?.editor.caret).toBe(0);
    mode.onPointer(at('pointerDown', 13, 5, { isShiftPressed: true }));
    expect(mode.session?.editor).toMatchObject({ anchor: 0, caret: 2 });
    mode.onPointer(at('pointerMove', 25, 5));
    mode.onPointer(at('pointerUp', 25, 5));
    expect(mode.session?.editor).toMatchObject({ anchor: 0, caret: 4 });
    mode.onPointer(at('pointerDown', 32, 5, { timeStamp: 100 }));
    mode.onPointer(at('pointerUp', 32, 5, { timeStamp: 120 }));
    mode.onPointer(at('pointerDown', 32, 5, { timeStamp: 200 }));
    expect(mode.session?.editor).toMatchObject({ anchor: 4, caret: 7 });
  });

  it('selects everything when started by Enter, and hides the selection frame while editing', () => {
    const { context } = createTextModeContext([tenPointText('t', 'abc')]);
    const mode = new TextMode(context, { kind: 'edit', id: 't' as ObjectId });
    expect(mode.session?.editor).toMatchObject({ anchor: 0, caret: 3 });
    const overlay = mode.overlay();
    expect(overlay.frame).toBeUndefined();
    expect(overlay.toolRects?.length).toBeGreaterThan(4);
  });

  it('commits and passes a press outside the box on to the select tool', () => {
    const { store, context } = createTextModeContext([tenPointText('t', 'abc')]);
    const mode = new TextMode(context, { kind: 'edit', id: 't' as ObjectId });
    expect(mode.onPointer(at('pointerDown', 300, 300))).toEqual({ isDone: true, isPassedOn: true });
    mode.exit();
    expect(textIn(store, 't').text).toBe('abc');
  });

  it('ends on Escape and selects the object', () => {
    const { context, record } = createTextModeContext([tenPointText('t', 'abc')]);
    const mode = new TextMode(context, { kind: 'edit', id: 't' as ObjectId });
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.exitRequests).toBe(1);
    expect(record.selected).toEqual([['t']]);
  });

  it('takes canvas keys when the text input has not got the keyboard', () => {
    const { store, context } = createTextModeContext([tenPointText('t', 'abc')]);
    const mode = new TextMode(context, {
      kind: 'edit',
      id: 't' as ObjectId,
      world: { x: 18, y: 5 },
    });
    expect(mode.onKey({ kind: 'nudge', direction: 'left', isLarge: true })).toBe(true);
    expect(mode.session?.editor).toMatchObject({ anchor: 3, caret: 2 });
    expect(mode.onKey({ kind: 'delete' })).toBe(true);
    expect(textIn(store, 't').text).toBe('ab');
    expect(mode.onKey({ kind: 'selectAll' })).toBe(true);
    expect(mode.onKey({ kind: 'enter' })).toBe(true);
    expect(textIn(store, 't').text).toBe('\n');
    const creating = new TextMode(context, { kind: 'create' });
    expect(creating.onKey({ kind: 'delete' })).toBe(false);
  });

  it('ends the step at a word end and at a caret jump', () => {
    const { context, record } = createTextModeContext([tenPointText('t', '')]);
    const mode = new TextMode(context, { kind: 'edit', id: 't' as ObjectId });
    const session = mode.session;
    session?.type('a');
    session?.type(' ');
    session?.move({ unit: 'character', direction: -1, isExtending: false });
    const id = String(session?.sessionId);
    expect(record.capture).toEqual([`typing:${id}:false`, `typing:${id}:true`, 'endStep']);
  });

  it('deletes text it created and emptied again within its typing step', () => {
    const { store, context, record } = createTextModeContext();
    const mode = new TextMode(context, { kind: 'create' });
    mode.onPointer(at('pointerDown', 0, 0));
    mode.onPointer(at('pointerUp', 0, 0));
    mode.session?.type('x');
    mode.session?.deleteBackward();
    const id = String(mode.session?.sessionId);
    mode.exit();
    expect(store.read().objects.size).toBe(0);
    expect(record.capture).toEqual([
      `typing:${id}:false`,
      `typing:${id}:false`,
      `typing:${id}:true`,
      'endStep',
    ]);
  });

  it('ends with a notice when a collaborator locks the text, what was typed already written', () => {
    const { store, context, record } = createTextModeContext([tenPointText('t', 'ab')]);
    const notices: string[] = [];
    const mode = new TextMode(
      { ...context, onNotice: (message) => notices.push(message) },
      { kind: 'edit', id: 't' as ObjectId, world: { x: 12, y: 5 } },
    );
    mode.session?.type('c');
    store.transact({ kind: 'user', principalId: 'user:bob' as never }, (transaction) => {
      transaction.patchObject('t' as ObjectId, { locked: true });
    });
    expect(record.exitRequests).toBe(1);
    expect(notices).toEqual([LOCKED_WHILE_EDITING_NOTICE]);
    mode.exit();
    expect(textIn(store, 't')).toMatchObject({ text: 'abc', locked: true });
  });

  it('follows the document when someone else edits the text, and ends when it is deleted', () => {
    const { store, context, record } = createTextModeContext([tenPointText('t', 'world')]);
    const mode = new TextMode(context, {
      kind: 'edit',
      id: 't' as ObjectId,
      world: { x: 30, y: 5 },
    });
    store.transact({ kind: 'user', principalId: 'user:bob' as never }, (transaction) => {
      transaction.patchObject('t' as ObjectId, {
        text: 'hello world',
        runs: [{ length: 11, style: TEN }],
      });
    });
    expect(mode.session?.editor.caret).toBe(11);
    store.transact({ kind: 'user', principalId: 'user:bob' as never }, (transaction) => {
      transaction.deleteObject('t' as ObjectId);
    });
    expect(record.exitRequests).toBe(1);
    // The session ends with nothing written: no recreation, no delete of its own.
    const written: unknown[] = [];
    const stop = store.subscribe((change) => written.push(change));
    mode.exit();
    stop();
    expect(written).toEqual([]);
    expect(store.get('t' as ObjectId)).toBeUndefined();
  });
});

describe('TextMode: styles, clipboard and composition', () => {
  it('keeps a style picked at a collapsed caret for the next characters', () => {
    const { store, context } = createTextModeContext([tenPointText('t', 'ab')]);
    const mode = new TextMode(context, {
      kind: 'edit',
      id: 't' as ObjectId,
      world: { x: 12, y: 5 },
    });
    mode.session?.setStyle({ weight: 700 });
    expect(mode.session?.currentStyle()).toMatchObject({ weight: 700 });
    mode.session?.type('c');
    expect(textIn(store, 't').runs).toEqual([
      { length: 2, style: TEN },
      { length: 1, style: { ...TEN, weight: 700 } },
    ]);
  });

  it('copies, cuts and pastes styled runs, and pastes plain text in the insert style', () => {
    const { store, context } = createTextModeContext([tenPointText('t', 'abcd')]);
    const mode = new TextMode(context, { kind: 'edit', id: 't' as ObjectId });
    const session = mode.session;
    if (session === undefined) throw new Error('no session');
    session.setStyle({ italic: true });
    expect(copySelection(session)).toEqual({
      text: 'abcd',
      runs: [{ length: 4, style: { ...TEN, italic: true } }],
    });
    const cut = cutSelection(session);
    expect(textIn(store, 't').text).toBe('');
    if (cut !== undefined) pasteInto(session, cut);
    pasteInto(session, 'x\r\ny');
    expect(textIn(store, 't').text).toBe('abcdx\ny');
    expect(textIn(store, 't').runs.at(-1)).toMatchObject({ style: { italic: true } });
  });

  it('shows a composition as a preview and writes it once, when it commits', () => {
    const { store, context, record } = createTextModeContext([tenPointText('t', 'ab')]);
    const mode = new TextMode(context, {
      kind: 'edit',
      id: 't' as ObjectId,
      world: { x: 12, y: 5 },
    });
    const session = mode.session;
    session?.startComposition();
    session?.updateComposition('か');
    expect(textIn(store, 't').text).toBe('ab');
    expect(record.previews.get('t' as ObjectId)).toMatchObject({ text: 'abか' });
    expect(session?.displayed().composition).toEqual([2, 3]);
    session?.commitComposition('漢');
    expect(record.previews.get('t' as ObjectId)).toBeUndefined();
    expect(textIn(store, 't').text).toBe('ab漢');
  });

  it("composes over a selection in the selection's style", () => {
    const bold = { ...TEN, weight: 700 as const };
    const object = tenPointText('t', 'ab', {
      runs: [
        { length: 1, style: TEN },
        { length: 1, style: bold },
      ],
    });
    const { store, context } = createTextModeContext([object]);
    const mode = new TextMode(context, {
      kind: 'edit',
      id: 't' as ObjectId,
      world: { x: 7, y: 5 },
    });
    mode.onPointer(at('pointerDown', 12, 5, { isShiftPressed: true }));
    mode.session?.startComposition();
    mode.session?.commitComposition('X');
    expect(textIn(store, 't').runs).toEqual([
      { length: 1, style: TEN },
      { length: 1, style: bold },
    ]);
  });
});

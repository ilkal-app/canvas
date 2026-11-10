// The sticky tool: a click creates a 200 × 200 note centred on it in the tool's colour
// and edits it with the text editor; the note grows as it is typed into and is kept empty; a
// press elsewhere ends the edit and passes the press on; Escape selects the note.
import { describe, expect, it } from 'vitest';

import type { ObjectId, StickyObject } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import { createTextModeContext, tenPointNote } from '../text/__fixtures__/text-mode-context.js';

import { DEFAULT_NOTE_COLOR } from './note-colors.js';
import { StickyMode } from './sticky-mode.js';

/**
 * A primary-button input at a world point, the camera at the origin at 100%.
 *
 * @param kind - Down, move or up.
 * @param x - World x, and CSS px.
 * @param y - World y.
 * @returns The input.
 */
function at(kind: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number) {
  return {
    kind,
    screen: { x, y },
    world: { x, y },
    isShiftPressed: false,
    isModPressed: false,
    zoom: 1,
  } satisfies ToolPointerInput;
}

/**
 * Clicks with a mode at a point.
 *
 * @param mode - The mode.
 * @param x - World x.
 * @param y - World y.
 * @returns The release's step.
 */
function click(mode: StickyMode, x: number, y: number) {
  mode.onPointer(at('pointerDown', x, y));
  return mode.onPointer(at('pointerUp', x, y));
}

describe('StickyMode', () => {
  it('asks for a crosshair and writes nothing until a click', () => {
    const { store, context } = createTextModeContext();
    const mode = new StickyMode(context, { kind: 'create' });
    expect(mode.id).toBe('sticky');
    expect(mode.cursor).toBe('crosshair');
    mode.onPointer(at('pointerDown', 10, 10));
    expect(store.read().objects.size).toBe(0);
  });

  it('creates a 200 × 200 note in the default yellow centred on a click, selected and edited', () => {
    const { store, context, record } = createTextModeContext();
    const mode = new StickyMode(context, { kind: 'create' });
    expect(click(mode, 300, 150)).toEqual({ isDone: false });
    const note = store.get('new-1' as ObjectId);
    expect(note).toMatchObject({
      type: 'sticky',
      x: 200,
      y: 50,
      width: 200,
      height: 200,
      text: '',
      color: DEFAULT_NOTE_COLOR,
      align: 'center',
      verticalAlign: 'middle',
    });
    expect(record.capture).toEqual(['command']);
    expect(record.selected).toEqual([['new-1']]);
    expect(mode.session?.id).toBe('new-1');
    expect(mode.cursor).toBe('text');
    expect(mode.overlay().toolRects?.length).toBeGreaterThan(0);
  });

  it("gives the note the tool's colour and the text the tool's style", () => {
    const { store, context } = createTextModeContext();
    const pink = [1, 0.74, 0.8, 1] as const;
    const mode = new StickyMode({ ...context, newNoteColor: () => [...pink] }, { kind: 'create' });
    click(mode, 0, 0);
    expect((store.get('new-1' as ObjectId) as StickyObject).color).toEqual(pink);
  });

  it("keeps a colour token as the tool's colour", () => {
    const { store, context } = createTextModeContext();
    const mode = new StickyMode(
      { ...context, newNoteColor: () => ({ token: 'accent' }) },
      { kind: 'create' },
    );
    click(mode, 0, 0);
    expect((store.get('new-1' as ObjectId) as StickyObject).color).toEqual({ token: 'accent' });
  });

  it('grows the note as it is typed into, at least square', () => {
    const { store, context } = createTextModeContext();
    const mode = new StickyMode(context, { kind: 'create' });
    click(mode, 100, 100);
    mode.session?.type('Hello');
    expect(store.get('new-1' as ObjectId)).toMatchObject({ text: 'Hello', height: 200 });
    mode.session?.type(Array.from({ length: 16 }, () => '\nx').join(''));
    expect((store.get('new-1' as ObjectId) as StickyObject).height).toBeGreaterThan(200);
  });

  it('keeps an empty note when a press elsewhere ends the edit, passing the press on', () => {
    const { store, context } = createTextModeContext();
    const mode = new StickyMode(context, { kind: 'create' });
    click(mode, 100, 100);
    expect(mode.onPointer(at('pointerDown', 500, 500))).toEqual({ isDone: true, isPassedOn: true });
    mode.exit();
    expect(store.get('new-1' as ObjectId)).toMatchObject({ type: 'sticky', text: '' });
  });

  it('selects the note on Escape and asks to end; with no note Escape just ends the tool', () => {
    const { context, record } = createTextModeContext();
    const mode = new StickyMode(context, { kind: 'create' });
    click(mode, 100, 100);
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.exitRequests).toBe(1);
    expect(record.selected.at(-1)).toEqual(['new-1']);
    const idle = new StickyMode(context, { kind: 'create' });
    expect(idle.onKey({ kind: 'escape' })).toBe(true);
    expect(record.exitRequests).toBe(2);
    expect(idle.onKey({ kind: 'delete' })).toBe(false);
  });

  it('edits an activated note at once, the caret where it was double-clicked', () => {
    const note = tenPointNote('n', 'abc');
    const { context } = createTextModeContext([note]);
    const mode = new StickyMode(context, { kind: 'edit', id: note.id, world: { x: 150, y: 100 } });
    expect(mode.session?.id).toBe('n');
    expect(mode.session?.editor.caret).toBe(3);
  });

  it('drops a cancelled press without creating anything', () => {
    const { store, context } = createTextModeContext();
    const mode = new StickyMode(context, { kind: 'create' });
    mode.onPointer(at('pointerDown', 10, 10));
    mode.onPointer({ kind: 'pointerCancel' });
    mode.onPointer(at('pointerUp', 10, 10));
    expect(store.read().objects.size).toBe(0);
  });
});

describe('StickyMode: edges', () => {
  it('edits nothing when the activated note is gone, and waits for a click', () => {
    const { context } = createTextModeContext();
    const mode = new StickyMode(context, { kind: 'edit', id: 'gone' as ObjectId });
    expect(mode.session).toBeUndefined();
    expect(mode.cursor).toBe('crosshair');
    expect(mode.overlay()).toEqual({});
  });

  it("aligns a new note's text as the tool's style asks", () => {
    const { store, context } = createTextModeContext();
    const mode = new StickyMode({ ...context, newTextAlign: () => 'left' }, { kind: 'create' });
    click(mode, 0, 0);
    expect(store.get('new-1' as ObjectId)).toMatchObject({ align: 'left' });
  });

  it('ignores a hover, a secondary click and a held finger until a note is made', () => {
    const { store, context } = createTextModeContext();
    const mode = new StickyMode(context, { kind: 'create' });
    const zoom = { zoom: 1 };
    expect(mode.onPointer(at('pointerMove', 5, 5))).toEqual({ isDone: false });
    expect(mode.onPointer({ ...at('pointerDown', 5, 5), kind: 'contextPress' })).toEqual({
      isDone: false,
    });
    expect(mode.onPointer({ kind: 'hold', timeStamp: 1, screen: { x: 5, y: 5 }, ...zoom })).toEqual(
      {
        isDone: false,
      },
    );
    expect(store.read().objects.size).toBe(0);
  });

  it('follows the zoom only while editing, where the caret is sized on screen', () => {
    const { context, record } = createTextModeContext();
    const mode = new StickyMode(context, { kind: 'create' });
    mode.onZoom(2);
    const idle = record.changes;
    click(mode, 100, 100);
    const editing = record.changes;
    mode.onZoom(4);
    expect(idle).toBe(0);
    expect(record.changes).toBe(editing + 1);
  });

  it('reports a creation the document refuses and keeps waiting for a click', () => {
    // The fixture's first new id is taken, so the document refuses the note.
    const { store, context } = createTextModeContext([tenPointNote('new-1', 'taken')]);
    const refusals: unknown[] = [];
    const mode = new StickyMode(
      { ...context, onCommandRefused: (errors) => refusals.push(...errors) },
      { kind: 'create' },
    );
    click(mode, 100, 100);
    expect(refusals).toHaveLength(1);
    expect(mode.session).toBeUndefined();
    expect(store.read().objects.size).toBe(1);
  });
});

describe('StickyMode.abandon', () => {
  it('ends the note’s editing writing nothing', () => {
    const { store, context } = createTextModeContext();
    const mode = new StickyMode(context, { kind: 'create' });
    click(mode, 300, 150);
    mode.session?.type('Hi');
    const before = store.read();
    mode.abandon();
    expect(store.read()).toBe(before);
    expect(store.get('new-1' as ObjectId)).toMatchObject({ text: 'Hi' });
  });
});

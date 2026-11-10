// Text on the engine's document side over the demo document, with the monospaced
// fake layout (__fixtures__/text-document.ts). The text tool in Chrome: tooling/scenario/specs/tools/text-*.spec.ts.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';
import { TextMode } from '@canvas/tools';

import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { setUpTextDocument as setUp } from './__fixtures__/text-document.js';
import { LOCAL_USER_ORIGIN } from './demo-document.js';

describe('DocumentText', () => {
  it('creates and edits text with the text tool, in the default style, and reports it', () => {
    const { document, press, text } = setUp();
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    document.tools.text.session()?.type('Hi');
    expect(text('text-1')).toMatchObject({
      text: 'Hi',
      runs: [{ length: 2, style: DEFAULT_TEXT_STYLE }],
    });
    expect(document.inspect().textEditing).toEqual({
      id: 'text-1',
      text: 'Hi',
      caret: 2,
      anchor: 2,
      isComposing: false,
    });
    expect(document.tools.text.styleContext()).toMatchObject({
      isEditing: true,
      align: 'left',
      edited: { id: 'text-1', type: 'text' },
    });
  });

  it('styles the pending style while editing; new text starts in the text tool’s style', () => {
    const { document, press, text } = setUp();
    document.panels.setToolStyle('text', { textStyle: { fontSize: 40 }, align: 'center' });
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    document.runCanvasAction({ type: 'selection', command: 'toggleBold' }, 1);
    document.tools.text.session()?.type('B');
    expect(text('text-1')).toMatchObject({ align: 'center' });
    expect(text('text-1').runs[0]?.style).toMatchObject({ weight: 700, fontSize: 40 });
    document.setActiveTool('select');
    document.setActiveTool('text');
    press('pointerDown', 20, 300);
    press('pointerUp', 20, 300);
    document.tools.text.session()?.type('n');
    // The pending bold was the first text's; the tool's style is unchanged by it.
    expect(text('text-2').runs[0]?.style).toMatchObject({ weight: 400, fontSize: 40 });
  });

  it('restyles and aligns selected text objects whole, and shows what they share', () => {
    const { document, press, text } = setUp();
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    document.tools.text.session()?.type('abc');
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    expect(document.inspect().selectedIds).toEqual(['text-1']);
    expect(document.tools.text.styleContext()).toMatchObject({
      isEditing: false,
      style: DEFAULT_TEXT_STYLE,
    });
    document.runCanvasAction({ type: 'selection', command: 'toggleItalic' }, 1);
    expect(text('text-1').runs).toEqual([
      { length: 3, style: { ...DEFAULT_TEXT_STYLE, italic: true } },
    ]);
    expect(document.tools.text.apply({ kind: 'align', align: 'center' })).toBe(true);
    expect(text('text-1').align).toBe('center');
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    expect(document.tools.text.styleContext()).toBeUndefined();
    expect(document.tools.text.apply({ kind: 'toggleBold' })).toBe(false);
  });

  it('sets the direction of the edited or selected text, and shows it', () => {
    const { document, press, text } = setUp();
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    // A draft the document does not hold yet reads as auto.
    expect(document.tools.text.styleContext()).toMatchObject({ direction: 'auto' });
    document.tools.text.session()?.type('abc');
    expect(document.tools.text.apply({ kind: 'direction', direction: 'rtl' })).toBe(true);
    expect(text('text-1').direction).toBe('rtl');
    expect(document.tools.text.styleContext()).toMatchObject({ isEditing: true, direction: 'rtl' });
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    expect(document.tools.text.apply({ kind: 'direction', direction: 'auto' })).toBe(true);
    expect(text('text-1').direction).toBe('auto');
    expect(document.tools.text.styleContext()).toMatchObject({
      isEditing: false,
      direction: 'auto',
    });
  });

  it('keeps editing a text when the pressed Text button is clicked again', () => {
    const { document, press } = setUp();
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    document.tools.text.session()?.type('keep');
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    const editing = document.tools.router.activeMode;
    expect(editing).toBeInstanceOf(TextMode);
    document.runCanvasAction({ type: 'reselectTool', tool: 'text' }, 1);
    expect(document.tools.router.activeMode).toBe(editing);
    expect(document.inspect().textEditing).toMatchObject({ id: 'text-1', caret: 4 });
  });

  it("edits a shape's label on Enter, and styles labels without alignment", () => {
    const { document, press, store } = setUp();
    const marker = 'section-0-rect-0-0' as ObjectId;
    press('pointerDown', 60, 60);
    press('pointerUp', 60, 60);
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    document.tools.text.session()?.type('Hi');
    expect(store.get(marker)).toMatchObject({ label: { text: 'Hi' } });
    expect(document.tools.text.styleContext()).toMatchObject({
      isEditing: true,
      align: undefined,
      canAlign: false,
      canDirect: false,
      edited: { id: marker, type: 'shape' },
    });
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    expect(document.inspect().selectedIds).toEqual([marker]);
    expect(document.tools.text.styleContext()).toMatchObject({
      isEditing: false,
      canAlign: false,
      canDirect: false,
      style: { fontSize: DEFAULT_TEXT_STYLE.fontSize },
    });
    expect(document.tools.text.styleContext()?.edited).toBeUndefined();
    document.runCanvasAction({ type: 'selection', command: 'toggleBold' }, 1);
    expect(store.get(marker)).toMatchObject({
      label: { runs: [{ length: 2, style: { ...DEFAULT_TEXT_STYLE, weight: 700 } }] },
    });
  });

  it('edits a text object on Enter and on a double-click, not a locked one', () => {
    const { document, press, store, onToolChange } = setUp();
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    document.tools.text.session()?.type('edit me');
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    expect(document.tools.router.activeMode).toBeInstanceOf(TextMode);
    expect(document.inspect().textEditing).toMatchObject({ anchor: 0, caret: 7 });
    expect(onToolChange).toHaveBeenLastCalledWith('text');
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    press('pointerDown', 30, 30, 1000);
    press('pointerUp', 30, 30, 1050);
    press('pointerDown', 30, 30, 1200);
    press('pointerUp', 30, 30, 1250);
    expect(document.inspect().textEditing?.caret).toBeLessThan(7);
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject('text-1' as ObjectId, { locked: true });
    });
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    expect(document.inspect().textEditing).toBeUndefined();
  });

  it('shows a composition as a preview through the scene source, not the document', () => {
    const { document, press, text, store } = setUp();
    const objectCount = store.read().objects.size;
    const enqueued: unknown[] = [];
    document.attach({
      enqueue: (changes) => enqueued.push(changes.get('text-1' as ObjectId)),
      showOverlay: () => undefined,
    });
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    document.tools.text.session()?.updateComposition('か');
    // The box is a draft until its first character commits: shown, not written.
    expect(store.read().objects.size).toBe(objectCount);
    expect(enqueued.at(-1)).toMatchObject({ text: 'か' });
    document.tools.text.session()?.commitComposition('漢');
    expect(text('text-1').text).toBe('漢');
  });

  it('makes each typed word one undo step', () => {
    const { document, press, text, history, store } = setUp();
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    const session = document.tools.text.session();
    for (const character of 'one two') session?.type(character);
    document.tools.text.policy.endStep();
    history.undo();
    expect(text('text-1').text).toBe('one ');
    // The first word's step created the box: undoing it leaves nothing, and editing ends.
    history.undo();
    expect(store.get('text-1' as ObjectId)).toBeUndefined();
    expect(document.tools.text.session()).toBeUndefined();
    expect(history.canUndo()).toBe(false);
  });

  it('reports the same style context object while typing does not change the style', () => {
    const { document, press } = setUp();
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    const session = document.tools.text.session();
    session?.type('a');
    const first = document.tools.text.styleContext();
    session?.type('b');
    session?.type('c');
    expect(document.tools.text.styleContext()).toBe(first);
    document.tools.text.apply({ kind: 'style', patch: { italic: true } });
    expect(document.tools.text.styleContext()).not.toBe(first);
  });

  it('writes nothing, and leaves no undo step, for a text tool click ended with Escape', () => {
    const { document, press, store, history } = setUp();
    const changeSets: unknown[] = [];
    const stop = store.subscribe((changes) => changeSets.push(changes));
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    expect(document.tools.text.session()).toBeDefined();
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    expect(document.tools.text.session()).toBeUndefined();
    stop();
    expect(changeSets).toEqual([]);
    expect(history.canUndo()).toBe(false);
  });
});

// The engine's document side for a person who cannot edit (a viewer): the one check
// every canvas action passes (`refuses`), the select tool that only selects, and no mode.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { everyShellAction } from '../state/__fixtures__/every-shell-action.js';
import { isEditingAction } from '../state/editing-actions.js';
import type { CanvasAction, ShellAction } from '../state/shell-action.js';

import { setUpTextDocument } from './__fixtures__/text-document.js';

/** The demo board's first rectangle: world (50, 50), 70 × 60. */
const MARKER = 'section-0-rect-0-0' as ObjectId;

/** The shell actions the canvas runs: all but the shell's own (tools, dialogs, the gate). */
const SHELL_ONLY = new Set<ShellAction['type']>([
  'selectTool',
  'setToolStyle',
  'toggleCheatSheet',
  'closeCheatSheet',
  'toggleDeveloperOverlay',
  'toggleInspector',
  'toggleCommentPlacing',
  'openToolPanel',
  'toggleLayersDrawer',
  'openBoardSearch',
  'setEditable',
]);

/**
 * Every canvas action of every kind and command.
 *
 * @returns The actions.
 */
function everyCanvasAction(): CanvasAction[] {
  return everyShellAction(MARKER).filter(
    (action): action is CanvasAction => !SHELL_ONLY.has(action.type),
  );
}

/**
 * The text fixture with a text object `text-1` (“Hi”) made at (20, 20) and left, the marker
 * selected, and every later document write counted.
 *
 * @returns The fixture and the write count.
 */
function setUp() {
  const fixture = setUpTextDocument();
  const { document, press, store } = fixture;
  document.setActiveTool('text');
  press('pointerDown', 20, 20);
  press('pointerUp', 20, 20);
  document.tools.text.session()?.type('Hi');
  document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
  document.setActiveTool('select');
  document.panels.board.select([MARKER]);
  const writes = { count: 0 };
  store.subscribeUpdates(() => {
    writes.count += 1;
  });
  return { ...fixture, writes };
}

describe('EngineDocument for a person who cannot edit', () => {
  it('refuses every editing canvas action, whichever kind, and writes nothing', () => {
    const { document, writes } = setUp();
    document.setEditable(false);
    const editing = everyCanvasAction().filter(isEditingAction);
    expect(editing.length).toBeGreaterThan(25);
    for (const action of editing) {
      expect(document.refuses(action), action.type).toBe(true);
      expect(document.runCanvasAction(action, 1)).toBe(true);
    }
    expect(writes.count).toBe(0);
    expect(document.inspect().selectedIds).toEqual([MARKER]);
  });

  it('pans with the arrows, even with something selected, and keeps selection commands', () => {
    const { document, writes } = setUp();
    document.setEditable(false);
    expect(document.runCanvasAction({ type: 'nudge', direction: 'left', isLarge: false }, 1)).toBe(
      false,
    );
    document.runCanvasAction({ type: 'selection', command: 'selectAll' }, 1);
    expect(document.inspect().selectedIds.length).toBeGreaterThan(1);
    expect(writes.count).toBe(0);
  });

  it('moves nothing on a drag and offers no handles', () => {
    const { document, press, store, writes } = setUp();
    document.setEditable(false);
    const before = store.get(MARKER);
    press('pointerDown', 60, 60);
    document.handlePointer(
      { kind: 'pointerMove', screen: { x: 90, y: 90 }, isShiftPressed: false, isModPressed: false },
      { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 },
    );
    press('pointerUp', 90, 90);
    expect(store.get(MARKER)).toEqual(before);
    expect(writes.count).toBe(0);
    expect(document.tools.overlay().canResize).toBe(false);
  });

  it('opens no editor on a double-click or Enter, and makes no creation tool active', () => {
    const { document, press, writes, onToolChange } = setUp();
    document.setEditable(false);
    onToolChange.mockClear();
    press('pointerDown', 22, 22, 1000);
    press('pointerUp', 22, 22, 1050);
    press('pointerDown', 22, 22, 1200);
    press('pointerUp', 22, 22, 1250);
    expect(document.inspect().selectedIds).toEqual(['text-1']);
    expect(document.inspect().textEditing).toBeUndefined();
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    expect(document.inspect().textEditing).toBeUndefined();
    document.setActiveTool('sticky');
    expect(document.tools.router.activeTool).toBe('select');
    // Nor the connector tool.
    document.setActiveTool('connector');
    expect(document.tools.router.activeTool).toBe('select');
    expect(document.tools.router.canActivate('text-1' as ObjectId)).toBe(false);
    expect(onToolChange).not.toHaveBeenCalled();
    expect(writes.count).toBe(0);
  });

  it('ends a text edit and a creation tool when the person is made a viewer', () => {
    const { document, press } = setUp();
    press('pointerDown', 22, 22, 1000);
    press('pointerUp', 22, 22, 1050);
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    expect(document.inspect().textEditing).toBeDefined();
    document.setEditable(false);
    expect(document.inspect().textEditing).toBeUndefined();
    expect(document.tools.router.activeTool).toBe('select');
    expect(document.canEdit).toBe(false);
  });

  it('drops a text edit on a downgrade, writing nothing: an emptied text is not deleted', () => {
    const { document, store, writes } = setUp();
    document.panels.board.select(['text-1' as ObjectId]);
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    const session = document.tools.text.session();
    session?.selectAll();
    session?.deleteBackward();
    expect(store.get('text-1' as ObjectId)).toMatchObject({ text: '' });
    const before = writes.count;
    // Made a viewer mid-edit: ending the editor as usual would delete the emptied text.
    document.setEditable(false);
    expect(writes.count).toBe(before);
    expect(store.get('text-1' as ObjectId)).toMatchObject({ text: '' });
    expect(document.inspect().textEditing).toBeUndefined();
    expect(document.tools.router.activeTool).toBe('select');
  });

  it('edits again once the person can: Enter opens the text, a nudge moves', () => {
    const { document, writes } = setUp();
    document.setEditable(false);
    document.setEditable(true);
    expect(document.canEdit).toBe(true);
    document.runCanvasAction({ type: 'nudge', direction: 'right', isLarge: false }, 1);
    expect(writes.count).toBe(1);
    document.panels.board.select(['text-1' as ObjectId]);
    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);
    expect(document.inspect().textEditing).toBeDefined();
  });
});

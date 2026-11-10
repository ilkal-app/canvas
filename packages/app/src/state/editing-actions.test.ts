import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { everyShellAction } from './__fixtures__/every-shell-action.js';
import { isEditingAction } from './editing-actions.js';
import type { ShellAction } from './shell-action.js';
import { INITIAL_SHELL_STATE, shellReducer, type ShellState } from './shell-reducer.js';

const OBJECT = 'object-1' as ObjectId;

/**
 * What a viewer keeps: looking, selecting, copying, panning (the hand too),
 * the dialogs.
 */
const KEPT = [
  'selectTool:select',
  'selectTool:hand',
  'reselectTool:select',
  'reselectTool:hand',
  'navigate:zoomIn',
  'navigate:zoomOut',
  'navigate:zoomToActualSize',
  'navigate:zoomToFit',
  'navigate:zoomToSelection',
  'navigate:toggleGrid',
  'navigate:toggleSnapping',
  'navigate:toggleMinimap',
  'navigate:previousPage',
  'navigate:nextPage',
  'frame',
  'panCamera',
  'zoomCamera',
  'selection:selectAll',
  'selection:selectSameType',
  'selection:deselect',
  'selection:copy',
  'selection:activate',
  'nudge:up',
  'nudge:down',
  'nudge:left',
  'nudge:right',
  'component:goToMain',
  'component:previewPreset',
  'toggleCheatSheet',
  'closeCheatSheet',
  'toggleDeveloperOverlay',
  'toggleInspector',
  'toggleCommentPlacing',
  'toggleReactions',
  'openToolPanel',
  'toggleLayersDrawer',
  'openBoardSearch',
  'focusSelectionPopover',
  'toggleDeleteConnectors',
];

/**
 * A short name for an action: its type and its command, tool or direction.
 *
 * @param action - The action.
 * @returns The name.
 */
function nameOf(action: ShellAction): string {
  if ('command' in action) return `${action.type}:${action.command}`;
  if ('tool' in action && action.type !== 'setToolStyle') return `${action.type}:${action.tool}`;
  if (action.type === 'nudge') return `nudge:${action.direction}`;
  return action.type;
}

const VIEWER: ShellState = { ...INITIAL_SHELL_STATE, canEdit: false };

describe('isEditingAction', () => {
  it('keeps navigation, selection, copy, the arrows and the dialogs; refuses everything else', () => {
    const actions = everyShellAction(OBJECT);
    expect(actions.filter((action) => !isEditingAction(action)).map(nameOf)).toEqual(KEPT);
    expect(actions.filter(isEditingAction).map(nameOf)).toEqual(
      expect.arrayContaining([
        'selectTool:sticky',
        'setToolStyle',
        'selection:delete',
        'selection:paste',
        'selection:cut',
        'selection:duplicate',
        'selection:toggleLock',
        'arrange:group',
        'arrange:createComponent',
        'arrange:bringToFront',
        'component:setOverride',
        'component:resetOverrides',
        'component:detach',
        'component:placeInstance',
        'component:rename',
        'component:setVariant',
        'component:setVariantAxes',
        'component:setPreset',
        'component:resetPreset',
        'history:undo',
        'history:redo',
        'style',
        'layout',
        'toggleLockOf',
        'placeLayers',
        'autoLayout',
      ]),
    );
    expect(isEditingAction({ type: 'setEditable', canEdit: true })).toBe(false);
  });
});

describe('shellReducer: a person who cannot edit', () => {
  it('records no editing canvas action and selects no creation tool, whichever kind', () => {
    for (const action of everyShellAction(OBJECT).filter(isEditingAction)) {
      expect(shellReducer(VIEWER, action), nameOf(action)).toBe(VIEWER);
    }
  });

  it('still takes what a viewer keeps', () => {
    const zoomed = shellReducer(VIEWER, { type: 'navigate', command: 'zoomIn' });
    expect(zoomed.lastCanvasAction?.action).toEqual({ type: 'navigate', command: 'zoomIn' });
    const copied = shellReducer(VIEWER, { type: 'selection', command: 'copy' });
    expect(copied.lastCanvasAction?.action).toEqual({ type: 'selection', command: 'copy' });
    expect(shellReducer(VIEWER, { type: 'toggleCheatSheet' }).isCheatSheetOpen).toBe(true);
  });

  it('makes the select tool active when the person can no longer edit', () => {
    const drawing: ShellState = { ...INITIAL_SHELL_STATE, activeTool: 'pen' };
    const viewing = shellReducer(drawing, { type: 'setEditable', canEdit: false });
    expect(viewing).toMatchObject({ canEdit: false, activeTool: 'select' });
    expect(shellReducer(viewing, { type: 'selectTool', tool: 'pen' })).toBe(viewing);
  });

  it('takes editing actions again once the person can edit', () => {
    const editing = shellReducer(VIEWER, { type: 'setEditable', canEdit: true });
    expect(editing.canEdit).toBe(true);
    expect(shellReducer(editing, { type: 'selectTool', tool: 'sticky' }).activeTool).toBe('sticky');
    expect(shellReducer(editing, { type: 'history', command: 'undo' }).lastCanvasAction).toEqual({
      action: { type: 'history', command: 'undo' },
      sequence: 1,
    });
  });

  it('changes nothing when told what it already holds', () => {
    expect(shellReducer(VIEWER, { type: 'setEditable', canEdit: false })).toBe(VIEWER);
    expect(shellReducer(INITIAL_SHELL_STATE, { type: 'setEditable', canEdit: true })).toBe(
      INITIAL_SHELL_STATE,
    );
  });
});

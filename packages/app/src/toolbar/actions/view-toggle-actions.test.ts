import { describe, expect, it } from 'vitest';

import { INITIAL_SHELL_STATE, shellReducer } from '../../state/shell-reducer.js';
import { DEFAULT_TOOLBAR_ACTIONS } from '../default-toolbar-actions.js';

import { toolbarAction as gridAction } from './grid-action.js';
import { toolbarAction as snappingAction } from './snapping-action.js';

describe('the grid and snapping toolbar toggles', () => {
  it('are found by the shell, grid first', () => {
    expect(DEFAULT_TOOLBAR_ACTIONS.map(({ id }) => id)).toEqual(['toggle-grid', 'toggle-snapping']);
  });

  it('flip their view preference and show it as pressed', () => {
    const hidden = { ...INITIAL_SHELL_STATE, isGridVisible: false, isSnappingOn: false };
    expect(gridAction.isPressed?.(hidden)).toBe(false);
    expect(snappingAction.isPressed?.(hidden)).toBe(false);
    const shown = [gridAction.action, snappingAction.action].reduce(shellReducer, hidden);
    expect(shown).toMatchObject({ isGridVisible: true, isSnappingOn: true });
    expect(gridAction.isPressed?.(shown)).toBe(true);
    expect(snappingAction.isPressed?.(shown)).toBe(true);
    expect(shown.lastCanvasAction).toBeUndefined();
  });
});

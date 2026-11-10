// A tool panel's key in the shell reducer: P chooses Draw while another tool is
// active, and while drawing P and E are recorded, numbered, for the floating dock; E outside
// Draw, and any key for a person who cannot edit, changes nothing.
import { describe, expect, it } from 'vitest';

import type { ShellAction } from './shell-action.js';
import { INITIAL_SHELL_STATE, shellReducer, type ShellState } from './shell-reducer.js';

const CYCLE: ShellAction = {
  type: 'toolPanelKey',
  tool: 'draw',
  key: 'cycle',
  shouldChooseTool: true,
};
const ERASER: ShellAction = {
  type: 'toolPanelKey',
  tool: 'draw',
  key: 'eraser',
  shouldChooseTool: false,
};

/**
 * Applies actions in turn.
 *
 * @param actions - The actions.
 * @param from - The state to start from.
 * @returns The state after them.
 */
function run(actions: readonly ShellAction[], from: ShellState = INITIAL_SHELL_STATE): ShellState {
  return actions.reduce(shellReducer, from);
}

describe('the toolPanelKey action', () => {
  it('chooses Draw with P from another tool, recording no key', () => {
    const state = run([CYCLE]);
    expect(state.activeTool).toBe('draw');
    expect(state.lastToolPanelKey).toBeUndefined();
  });

  it('records P and E while drawing, each with the next sequence number', () => {
    const drawing = run([{ type: 'selectTool', tool: 'draw' }]);
    const cycled = run([CYCLE], drawing);
    expect(cycled.lastToolPanelKey).toEqual({ tool: 'draw', key: 'cycle', sequence: 1 });
    const erased = run([ERASER, CYCLE], cycled);
    expect(erased.lastToolPanelKey).toEqual({ tool: 'draw', key: 'cycle', sequence: 3 });
    expect(erased.activeTool).toBe('draw');
  });

  it('leaves E to Reactions outside Draw: the same state', () => {
    const shapes = run([{ type: 'selectTool', tool: 'shape' }]);
    expect(shellReducer(shapes, ERASER)).toBe(shapes);
  });

  it('does nothing for a person who cannot edit', () => {
    const viewer = run([{ type: 'setEditable', canEdit: false }]);
    expect(shellReducer(viewer, CYCLE)).toBe(viewer);
  });
});

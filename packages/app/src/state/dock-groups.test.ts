import { describe, expect, it } from 'vitest';

import { dockButtonAction } from './dock-buttons.js';
import {
  dockGroupButtonOf,
  dockGroupOfTool,
  INITIAL_DOCK_GROUP_TOOLS,
  withDockGroupTool,
} from './dock-groups.js';
import type { ShellAction } from './shell-action.js';
import { INITIAL_SHELL_STATE, shellReducer } from './shell-reducer.js';

/**
 * The state after actions, from the initial one.
 *
 * @param actions - The actions.
 * @returns The state.
 */
function after(...actions: ShellAction[]) {
  return actions.reduce(shellReducer, INITIAL_SHELL_STATE);
}

/**
 * The action that chooses a flyout item.
 *
 * @param id - The item.
 * @returns Its action.
 * @throws {Error} When the item chooses nothing.
 */
function choose(id: Parameters<typeof dockButtonAction>[0]): ShellAction {
  const action = dockButtonAction(id);
  if (action === undefined) throw new Error(`${id} chooses nothing`);
  return action;
}

describe('flyout groups', () => {
  it('know which tools their items choose', () => {
    expect(dockGroupOfTool('shape')).toBe('shapes');
    expect(dockGroupOfTool('line')).toBe('lines');
    expect(dockGroupOfTool('connector')).toBe('lines');
    expect(dockGroupOfTool('pen')).toBeUndefined();
  });

  it('start as the rectangle and the line', () => {
    expect(dockGroupButtonOf('shapes', INITIAL_DOCK_GROUP_TOOLS, {})).toMatchObject({
      item: 'rectangle',
      label: 'Rectangle',
      name: 'Shape: Rectangle',
    });
    expect(dockGroupButtonOf('lines', INITIAL_DOCK_GROUP_TOOLS, {})).toMatchObject({
      item: 'line',
      label: 'Line',
      name: 'Line',
    });
  });

  it('show the item last chosen, and pressing the button chooses it again', () => {
    for (const item of ['rectangle', 'ellipse', 'triangle', 'polygon', 'star'] as const) {
      const state = after(choose(item), { type: 'selectTool', tool: 'select' });
      const button = dockGroupButtonOf('shapes', state.dockGroupTools, state.toolStyles);
      expect(button.item, item).toBe(item);
      expect(button.action, item).toEqual(choose(item));
    }
    for (const item of ['line', 'arrow', 'elbow-connector', 'connector'] as const) {
      const state = after(choose(item), { type: 'selectTool', tool: 'select' });
      const button = dockGroupButtonOf('lines', state.dockGroupTools, state.toolStyles);
      expect(button.item, item).toBe(item);
      expect(button.action, item).toEqual(choose(item));
    }
  });

  it('name the connector’s elbow as a variant of the connector', () => {
    const state = after(choose('elbow-connector'));
    expect(dockGroupButtonOf('lines', state.dockGroupTools, state.toolStyles)).toMatchObject({
      tool: 'connector',
      label: 'Elbow connector',
      name: 'Connector: Elbow connector',
    });
  });

  it('make the triangle a three-sided polygon, and the polygon and star leave three sides', () => {
    const triangle = after(choose('triangle'));
    expect(triangle.toolStyles.shape).toEqual({ kind: 'polygon', sides: 3 });
    expect(after(choose('triangle'), choose('polygon')).toolStyles.shape).toEqual({
      kind: 'polygon',
      sides: 5,
    });
    expect(after(choose('triangle'), choose('star')).toolStyles.shape).toEqual({
      kind: 'star',
      sides: 5,
    });
    // Sides picked in the panel stay when the polygon is chosen again.
    const eight = after(choose('polygon'), {
      type: 'setToolStyle',
      tool: 'shape',
      style: { sides: 8 },
    });
    expect(shellReducer(eight, choose('polygon')).toolStyles.shape).toMatchObject({ sides: 8 });
  });

  it('show a kind picked in the panel that no item chooses (the diamond) by name', () => {
    const button = dockGroupButtonOf('shapes', INITIAL_DOCK_GROUP_TOOLS, {
      shape: { kind: 'diamond' },
    });
    expect(button).toMatchObject({ item: undefined, label: 'Diamond', name: 'Shape: Diamond' });
    expect(button.action).toEqual({ type: 'selectTool', tool: 'shape' });
  });

  it('keep the same object when the group already stands for the tool', () => {
    expect(withDockGroupTool(INITIAL_DOCK_GROUP_TOOLS, 'line')).toBe(INITIAL_DOCK_GROUP_TOOLS);
    expect(withDockGroupTool(INITIAL_DOCK_GROUP_TOOLS, 'pen')).toBe(INITIAL_DOCK_GROUP_TOOLS);
    expect(withDockGroupTool(INITIAL_DOCK_GROUP_TOOLS, 'connector')).toEqual({
      shapes: 'shape',
      lines: 'connector',
    });
  });
});

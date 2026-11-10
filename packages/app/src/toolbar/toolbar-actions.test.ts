import { describe, expect, it } from 'vitest';

import { DEFAULT_TOOLBAR_ACTIONS } from './default-toolbar-actions.js';
import {
  createToolbarActionRegistry,
  isToolbarAction,
  registerToolbarAction,
  type ToolbarAction,
} from './toolbar-actions.js';

function action(id: string, order: number): ToolbarAction {
  return { id, label: id, order, action: { type: 'navigate', command: 'toggleGrid' } };
}

describe('the toolbar action registry', () => {
  it('keeps actions by order, then id, without changing the registry it was given', () => {
    const empty = createToolbarActionRegistry();
    const registry = [action('b', 2), action('c', 1), action('a', 2)].reduce(
      registerToolbarAction,
      empty,
    );
    expect(registry.actions.map(({ id }) => id)).toEqual(['c', 'a', 'b']);
    expect(empty.actions).toEqual([]);
  });

  it('refuses a second action with the same id', () => {
    const registry = registerToolbarAction(createToolbarActionRegistry(), action('a', 1));
    expect(() => registerToolbarAction(registry, action('a', 1))).toThrow(
      'A toolbar action "a" is already registered.',
    );
  });

  it('recognises an action by its shape', () => {
    expect(isToolbarAction(action('a', 1))).toBe(true);
    expect(isToolbarAction({ ...action('a', 1), isPressed: () => true })).toBe(true);
    expect(isToolbarAction(undefined)).toBe(false);
    expect(isToolbarAction(7)).toBe(false);
    expect(isToolbarAction({ ...action('a', 1), action: null })).toBe(false);
    expect(isToolbarAction({ ...action('a', 1), isPressed: true })).toBe(false);
  });

  it('finds the action files the shell ships, each one well formed', () => {
    for (const shipped of DEFAULT_TOOLBAR_ACTIONS) {
      expect(isToolbarAction(shipped), shipped.id).toBe(true);
    }
  });
});

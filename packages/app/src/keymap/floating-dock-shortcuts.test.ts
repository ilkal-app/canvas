// The floating dock's keys: one per tool plus Shift+N, replacing the classic
// tools category without clashing with any other shortcut.
import { describe, expect, it } from 'vitest';

import { createShortcutRegistry, registerShortcut } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';

import { DEFAULT_SHORTCUTS } from './default-keymap.js';
import {
  FLOATING_DOCK_SHORTCUTS,
  STACK_STICKY_CHORD,
  withFloatingDockShortcuts,
} from './floating-dock-shortcuts.js';

const PLACEHOLDER: ShellAction = { type: 'toggleCheatSheet' };

describe('the floating dock keys', () => {
  it('lists each tool’s key in dock order, then Shift+N', () => {
    expect(FLOATING_DOCK_SHORTCUTS.map(({ chord }) => chord)).toEqual([
      'v',
      'h',
      'f',
      's',
      'i',
      't',
      'c',
      'p',
      'n',
      'm',
      'e',
      STACK_STICKY_CHORD,
    ]);
    expect(STACK_STICKY_CHORD).toBe('shift+n');
  });

  it('replaces the classic tools category and registers without a clash', () => {
    const list = withFloatingDockShortcuts(DEFAULT_SHORTCUTS, () => PLACEHOLDER);
    const tools = list.filter(({ category }) => category === 'tools');
    expect(tools.map(({ id }) => id)).toEqual(FLOATING_DOCK_SHORTCUTS.map(({ id }) => id));
    for (const platform of ['mac', 'other'] as const) {
      expect(() =>
        list.reduce(
          (registry, definition) => registerShortcut(registry, definition),
          createShortcutRegistry<ShellAction>(platform),
        ),
      ).not.toThrow();
    }
  });

  it('keeps every other shortcut and passes each key to the action mapper', () => {
    const seen: string[] = [];
    const list = withFloatingDockShortcuts(DEFAULT_SHORTCUTS, (shortcut) => {
      seen.push(shortcut.kind === 'tool' ? shortcut.tool : shortcut.kind);
      return PLACEHOLDER;
    });
    const others = DEFAULT_SHORTCUTS.filter(({ category }) => category !== 'tools');
    expect(list.slice(0, others.length)).toEqual(others);
    expect(seen.at(-1)).toBe('stackSticky');
    expect(seen).toContain('reactions');
  });
});

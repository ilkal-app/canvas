import { describe, expect, it } from 'vitest';

import {
  createShortcutRegistry,
  listShortcuts,
  registerShortcut,
} from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';

import { whiteboardSheetOf } from './whiteboard-sheet.js';

describe('whiteboardSheetOf', () => {
  it('puts tools it does not order after the dock’s, and drops a group left empty', () => {
    const action: ShellAction = { type: 'toggleCheatSheet' };
    let registry = createShortcutRegistry<ShellAction>('other');
    for (const [id, chord, category] of [
      ['tools.later', 'q', 'tools'],
      ['tools.select', 'v', 'tools'],
      ['help.developer-overlay', 'mod+shift+d', 'help'],
    ] as const) {
      registry = registerShortcut(registry, {
        id,
        chords: [chord],
        description: id,
        category,
        action,
      });
    }
    const groups = whiteboardSheetOf(listShortcuts(registry), 'other');
    expect(groups.map((group) => group.category)).toEqual(['tools']);
    expect(groups[0]?.entries.map((entry) => entry.id)).toEqual(['tools.select', 'tools.later']);
  });
});

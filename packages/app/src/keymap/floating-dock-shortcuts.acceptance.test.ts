// And: acceptance for floating dock keys and sticky stacking.
import { describe, expect, it } from 'vitest';

import { createShortcutRegistry, registerShortcut } from '../shortcuts/shortcut-registry.js';

import { DEFAULT_SHORTCUTS } from './default-keymap.js';
import {
  FLOATING_DOCK_SHORTCUTS,
  STACK_STICKY_CHORD,
  withFloatingDockShortcuts,
} from './floating-dock-shortcuts.js';

describe('floating dock shortcuts', () => {
  it('binds every dock tool in order and Shift+N for stacking a sticky', () => {
    expect(FLOATING_DOCK_SHORTCUTS.map(({ id, chord }) => [id, chord])).toEqual([
      ['tools.select', 'v'],
      ['tools.pan', 'h'],
      ['tools.section', 'f'],
      ['tools.shapes', 's'],
      ['tools.image', 'i'],
      ['tools.text', 't'],
      ['tools.connector', 'c'],
      ['tools.draw', 'p'],
      ['tools.sticky', 'n'],
      ['tools.comment', 'm'],
      ['tools.reactions', 'e'],
      ['tools.stack-sticky', 'shift+n'],
    ]);
    expect(STACK_STICKY_CHORD).toBe('shift+n');
    expect(FLOATING_DOCK_SHORTCUTS.at(-1)).toMatchObject({ kind: 'stackSticky', chord: 'shift+n' });
  });

  it('replaces only classic tools and preserves all other shortcuts including contributions', () => {
    const original = [...DEFAULT_SHORTCUTS];
    const floating = withFloatingDockShortcuts(DEFAULT_SHORTCUTS, () => ({
      type: 'toggleCheatSheet',
    }));
    const others = DEFAULT_SHORTCUTS.filter(({ category }) => category !== 'tools');
    expect(floating.slice(0, others.length)).toEqual(others);
    expect(floating.filter(({ category }) => category === 'tools').map(({ id }) => id)).toEqual(
      FLOATING_DOCK_SHORTCUTS.map(({ id }) => id),
    );
    expect(floating.some(({ id }) => id === 'tools.pen' || id === 'tools.line')).toBe(false);
    expect(DEFAULT_SHORTCUTS).toEqual(original);
  });

  it.each(['mac', 'other'] as const)('registers without a clash on %s', (platform) => {
    const floating = withFloatingDockShortcuts(DEFAULT_SHORTCUTS, () => ({
      type: 'toggleCheatSheet',
    }));
    const registry = floating.reduce(
      (current, shortcut) => registerShortcut(current, shortcut),
      createShortcutRegistry(platform),
    );
    expect(registry.entries).toHaveLength(floating.length);
    expect(registry.entries.filter(({ category }) => category === 'tools')).toHaveLength(12);
  });
});

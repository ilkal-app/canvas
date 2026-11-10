// The layers drawer's shortcut, in the default keymap with the core list and the dock's
// keys, without a conflict.
import { describe, expect, it } from 'vitest';

import type { KeyEventLike } from '../../shortcuts/key-event-match.js';
import { matchShortcut } from '../../shortcuts/shortcut-registry.js';
import { createDefaultShortcutRegistry } from '../default-keymap.js';

function keyEvent(key: string, overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key,
    code: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  };
}

const TOGGLE = { type: 'toggleLayersDrawer' };

describe('the layers drawer shortcut', () => {
  it('is alt+1 on both platforms, listed under navigation, with no conflict', () => {
    for (const platform of ['mac', 'other'] as const) {
      const registry = createDefaultShortcutRegistry(platform);
      const entries = registry.entries.filter((entry) => entry.id === 'navigation.layers-drawer');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.category).toBe('navigation');
      expect(entries[0]?.action).toEqual(TOGGLE);
    }
  });

  it('matches Option+1 on a Mac, which types ¡, by the digit key’s position', () => {
    const registry = createDefaultShortcutRegistry('mac');
    expect(
      matchShortcut(keyEvent('¡', { altKey: true, code: 'Digit1' }), registry)?.action,
    ).toEqual(TOGGLE);
  });

  it('matches Alt+1 elsewhere, and on AZERTY, whose 1 key types &', () => {
    const registry = createDefaultShortcutRegistry('other');
    expect(
      matchShortcut(keyEvent('1', { altKey: true, code: 'Digit1' }), registry)?.action,
    ).toEqual(TOGGLE);
    expect(
      matchShortcut(keyEvent('&', { altKey: true, code: 'Digit1' }), registry)?.action,
    ).toEqual(TOGGLE);
  });

  it('leaves 1 alone, and Shift+1 to zoom to fit', () => {
    const registry = createDefaultShortcutRegistry('other');
    expect(matchShortcut(keyEvent('1', { code: 'Digit1' }), registry)).toBeUndefined();
    expect(
      matchShortcut(keyEvent('!', { shiftKey: true, code: 'Digit1' }), registry)?.action,
    ).toEqual({ type: 'navigate', command: 'zoomToFit' });
  });
});

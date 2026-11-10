import { describe, expect, it } from 'vitest';

import type { KeyEventLike } from './key-event-match.js';
import {
  createShortcutRegistry,
  findShortcutConflict,
  listShortcuts,
  matchShortcut,
  registerShortcut,
  type ShortcutDefinition,
  type ShortcutRegistry,
} from './shortcut-registry.js';

type TestAction = string;

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

function define(
  id: string,
  chords: string[],
  overrides: Partial<ShortcutDefinition<TestAction>> = {},
): ShortcutDefinition<TestAction> {
  return { id, chords, description: id, category: 'tools', action: id, ...overrides };
}

function registryOf(
  definitions: ShortcutDefinition<TestAction>[],
  platform: 'mac' | 'other' = 'mac',
): ShortcutRegistry<TestAction> {
  return definitions.reduce(
    (registry, definition) => registerShortcut(registry, definition),
    createShortcutRegistry<TestAction>(platform),
  );
}

describe('registerShortcut', () => {
  it('returns a new registry and leaves the original untouched', () => {
    const empty = createShortcutRegistry<TestAction>('mac');
    const withSelect = registerShortcut(empty, define('select', ['v']));
    expect(empty.entries).toHaveLength(0);
    expect(withSelect.entries).toHaveLength(1);
    expect(withSelect.entries[0]?.parsedChords[0]?.key).toBe('v');
  });

  it('does not mutate the definition it is given', () => {
    const definition = define('undo', ['mod+z']);
    const snapshot = structuredClone(definition);
    registerShortcut(createShortcutRegistry<TestAction>('mac'), definition);
    expect(definition).toEqual(snapshot);
  });

  it('marks shortcuts neither native nor repeating unless the definition says so', () => {
    const registry = registryOf([
      define('select', ['v']),
      define('nudge', ['arrowup'], { canRepeat: true }),
      define('copy', ['mod+c'], { isNative: true }),
    ]);
    expect(registry.entries.map(({ isNative, canRepeat }) => [isNative, canRepeat])).toEqual([
      [false, false],
      [false, true],
      [true, false],
    ]);
  });

  it('rejects a second shortcut with the same id', () => {
    const registry = registryOf([define('select', ['v'])]);
    expect(() => registerShortcut(registry, define('select', ['s']))).toThrow(
      /"select" is already registered/,
    );
  });

  it('rejects a chord another shortcut already uses, naming both', () => {
    const registry = registryOf([define('undo', ['mod+z'])]);
    expect(() => registerShortcut(registry, define('revert', ['meta+z']))).toThrow(
      /"revert" uses meta\+z, which "undo" already uses/,
    );
  });

  it('rejects the same chord twice within one shortcut', () => {
    expect(() => registryOf([define('zoom', ['mod+=', 'meta+='])])).toThrow(/twice/);
  });

  it('rejects a shortcut with no chords', () => {
    expect(() => registryOf([define('nothing', [])])).toThrow(/at least one chord/);
  });

  it('treats mod+z and ctrl+z as distinct on mac but conflicting elsewhere', () => {
    expect(() =>
      registryOf([define('a', ['mod+z']), define('b', ['ctrl+z'])], 'mac'),
    ).not.toThrow();
    expect(() => registryOf([define('a', ['mod+z']), define('b', ['ctrl+z'])], 'other')).toThrow(
      /already uses/,
    );
  });
});

describe('findShortcutConflict', () => {
  it('names the shortcut that already uses a chord', () => {
    const registry = registryOf([define('undo', ['mod+z'])]);
    expect(findShortcutConflict(registry, 'meta+z')?.id).toBe('undo');
  });

  it('returns undefined for a free chord', () => {
    const registry = registryOf([define('undo', ['mod+z'])]);
    expect(findShortcutConflict(registry, 'mod+shift+z')).toBeUndefined();
  });

  it('counts native shortcuts as taken', () => {
    const registry = registryOf([define('copy', ['mod+c'], { isNative: true })]);
    expect(findShortcutConflict(registry, 'mod+c')?.id).toBe('copy');
  });
});

describe('matchShortcut', () => {
  it('finds the shortcut whose chord the event presses', () => {
    const registry = registryOf([define('undo', ['mod+z']), define('redo', ['mod+shift+z'])]);
    expect(matchShortcut(keyEvent('z', { metaKey: true }), registry)?.id).toBe('undo');
    expect(matchShortcut(keyEvent('Z', { metaKey: true, shiftKey: true }), registry)?.id).toBe(
      'redo',
    );
  });

  it('matches any of a shortcut’s chords', () => {
    const registry = registryOf([define('delete', ['delete', 'backspace'])]);
    expect(matchShortcut(keyEvent('Backspace'), registry)?.id).toBe('delete');
    expect(matchShortcut(keyEvent('Delete'), registry)?.id).toBe('delete');
  });

  it('returns undefined when nothing matches', () => {
    const registry = registryOf([define('select', ['v'])]);
    expect(matchShortcut(keyEvent('q'), registry)).toBeUndefined();
  });

  it('never matches a native shortcut, which the browser’s own event carries', () => {
    const registry = registryOf([define('copy', ['mod+c'], { isNative: true })]);
    expect(matchShortcut(keyEvent('c', { metaKey: true }), registry)).toBeUndefined();
  });

  it('prefers an exact modifier match over a Shift-insensitive symbol match', () => {
    const registry = registryOf([define('one', ['1']), define('shift-one', ['shift+1'])]);
    // An AZERTY keyboard types "1" with Shift held.
    expect(matchShortcut(keyEvent('1', { shiftKey: true }), registry)?.id).toBe('shift-one');
    expect(matchShortcut(keyEvent('1'), registry)?.id).toBe('one');
  });

  it('lets Shift and a digit key keep its digit shortcut over a symbol it types', () => {
    const registry = registryOf([
      define('zoom-in', ['=', '+']),
      define('actual-size', ['shift+0']),
      define('fit', ['shift+1']),
      define('help', ['?']),
      define('minimap', ['shift+m']),
    ]);
    // German Shift+0 types "=", Swiss Shift+1 types "+".
    expect(matchShortcut(keyEvent('=', { code: 'Digit0', shiftKey: true }), registry)?.id).toBe(
      'actual-size',
    );
    expect(matchShortcut(keyEvent('+', { code: 'Digit1', shiftKey: true }), registry)?.id).toBe(
      'fit',
    );
    // The symbols still match on their own keys, Shifted (US +) or not (German +).
    expect(matchShortcut(keyEvent('+', { code: 'Equal', shiftKey: true }), registry)?.id).toBe(
      'zoom-in',
    );
    expect(matchShortcut(keyEvent('+', { code: 'BracketRight' }), registry)?.id).toBe('zoom-in');
    // Off the digit row the symbol still wins: AZERTY types "?" with Shift on the M position.
    expect(matchShortcut(keyEvent('?', { code: 'KeyM', shiftKey: true }), registry)?.id).toBe(
      'help',
    );
  });

  it('prefers the typed character over the physical key', () => {
    // On AZERTY the key labelled A sends code KeyQ.
    const registry = registryOf([define('a-tool', ['a']), define('q-tool', ['q'])]);
    expect(matchShortcut(keyEvent('a', { code: 'KeyQ' }), registry)?.id).toBe('a-tool');
  });

  it('falls back to the physical key when the character does not match', () => {
    const registry = registryOf([define('align-left', ['alt+a'])]);
    expect(matchShortcut(keyEvent('å', { code: 'KeyA', altKey: true }), registry)?.id).toBe(
      'align-left',
    );
  });
  it('never uses the physical key when the layout typed a letter, as on Dvorak', () => {
    const registry = registryOf([define('sticky', ['s']), define('text', ['t'])]);
    // Dvorak types "o" on the key QWERTY calls S, and "y" on T.
    expect(matchShortcut(keyEvent('o', { code: 'KeyS' }), registry)).toBeUndefined();
    expect(matchShortcut(keyEvent('y', { code: 'KeyT' }), registry)).toBeUndefined();
  });

  it('does not turn Ctrl+Y on QWERTZ into Ctrl+Z, or Ctrl+Q on AZERTY into Ctrl+A', () => {
    const registry = registryOf(
      [define('undo', ['mod+z']), define('select-all', ['mod+a'])],
      'other',
    );
    expect(matchShortcut(keyEvent('y', { code: 'KeyZ', ctrlKey: true }), registry)).toBeUndefined();
    expect(matchShortcut(keyEvent('q', { code: 'KeyA', ctrlKey: true }), registry)).toBeUndefined();
  });

  it('uses the physical key for a non-Latin layout, where the letter is not ASCII', () => {
    const registry = registryOf([define('text', ['t'])]);
    // Russian ЙЦУКЕН types "е" on the key QWERTY calls T.
    expect(matchShortcut(keyEvent('е', { code: 'KeyT' }), registry)?.id).toBe('text');
  });
});

describe('listShortcuts', () => {
  it('groups shortcuts by category in the cheat sheet order, skipping empty categories', () => {
    const registry = registryOf([
      define('undo', ['mod+z'], { category: 'history' }),
      define('select', ['v'], { category: 'tools' }),
      define('zoom-in', ['mod+='], { category: 'navigation' }),
      define('text', ['t'], { category: 'tools' }),
    ]);
    const groups = listShortcuts(registry);
    expect(groups.map((group) => group.category)).toEqual(['tools', 'navigation', 'history']);
    expect(groups[0]?.label).toBe('Tools');
    expect(groups[0]?.entries.map((entry) => entry.id)).toEqual(['select', 'text']);
  });

  it('lists native shortcuts too, since the cheat sheet documents them', () => {
    const registry = registryOf([
      define('copy', ['mod+c'], { isNative: true, category: 'selection' }),
    ]);
    expect(listShortcuts(registry)[0]?.entries[0]?.id).toBe('copy');
  });
});

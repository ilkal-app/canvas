import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { MenuEntry, MenuItemEntry } from '../controls/menu.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';

import { selectionMoreEntries } from './more-menu.js';

const SHORTCUTS = createDefaultShortcutRegistry('mac');

/**
 * A selected object of a type, locked or not.
 *
 * @param id - Its id.
 * @param type - Its type.
 * @param isLocked - Whether it is locked.
 * @returns The object.
 */
function object(id: string, type = 'shape', isLocked = false): BoardObject {
  return { id: id as ObjectId, type, locked: isLocked } as unknown as BoardObject;
}

/**
 * The items' names, separators as `—`.
 *
 * @param entries - The menu's lines.
 * @returns The names.
 */
function names(entries: readonly MenuEntry[]): string[] {
  return entries.map((entry) => (entry.kind === 'separator' ? '—' : entry.label));
}

describe('selectionMoreEntries', () => {
  it('offers the ticket’s actions for one object, Delete last in the red pencil', () => {
    const entries = selectionMoreEntries([object('a')], SHORTCUTS, vi.fn());
    expect(names(entries)).toEqual([
      'Duplicate',
      'Lock',
      '—',
      'Bring forward',
      'Send backward',
      'Bring to front',
      'Send to back',
      '—',
      'Delete',
    ]);
    const items = entries.filter((entry): entry is MenuItemEntry => entry.kind !== 'separator');
    expect(items.at(-1)?.isDanger).toBe(true);
    // Item 2: absent shell capabilities omit these formerly disabled placeholders.
    expect(items.filter((item) => item.isDisabled === true)).toEqual([]);
  });

  it('shows each action’s shortcut and dispatches it', () => {
    const dispatch = vi.fn();
    const entries = selectionMoreEntries([object('a')], SHORTCUTS, dispatch);
    const duplicate = entries.find((entry) => entry.id === 'Duplicate') as MenuItemEntry;
    expect(duplicate.meta).toBe('⌘D');
    duplicate.onSelect?.();
    expect(dispatch).toHaveBeenCalledWith({ type: 'selection', command: 'duplicate' });
    const toFront = entries.find((entry) => entry.id === 'Bring to front') as MenuItemEntry;
    toFront.onSelect?.();
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'arrange', command: 'bringToFront' });
  });

  it('offers Group for several objects and Ungroup when a group is among them', () => {
    const several = names(selectionMoreEntries([object('a'), object('b')], SHORTCUTS, vi.fn()));
    expect(several).toContain('Group');
    expect(several).not.toContain('Ungroup');
    const withGroup = names(
      selectionMoreEntries([object('g', 'group'), object('b')], SHORTCUTS, vi.fn()),
    );
    expect(withGroup).toEqual(expect.arrayContaining(['Group', 'Ungroup']));
    expect(names(selectionMoreEntries([object('g', 'group')], SHORTCUTS, vi.fn()))).toContain(
      'Ungroup',
    );
  });

  it('offers a locked selection Unlock when no shell capabilities are provided', () => {
    const dispatch = vi.fn();
    const entries = selectionMoreEntries([object('a', 'shape', true)], SHORTCUTS, dispatch);
    // Item 2: old not-available rows are now omitted when callbacks are absent.
    expect(names(entries)).toEqual(['Unlock']);
    (entries[0] as MenuItemEntry).onSelect?.();
    expect(dispatch).toHaveBeenCalledWith({ type: 'selection', command: 'toggleLock' });
  });
});

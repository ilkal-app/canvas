import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { MenuItemEntry } from '../controls/menu.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';

import { selectionMoreEntries } from './more-menu.js';

const SHORTCUTS = createDefaultShortcutRegistry('mac');

/**
 * A selected shape or group.
 *
 * @param name - Its id.
 * @param type - Its kind.
 * @param isLocked - Whether it is locked.
 * @returns The selected object.
 */
function selected(name: string, type = 'shape', isLocked = false): BoardObject {
  return { id: name as ObjectId, type, locked: isLocked } as BoardObject;
}

describe('selection More menu acceptance', () => {
  it('dispatches every available command through its own item', () => {
    const dispatch = vi.fn();
    const entries = selectionMoreEntries(
      [selected('group', 'group'), selected('shape')],
      SHORTCUTS,
      dispatch,
    );
    const expected = [
      ['Duplicate', 'selection', 'duplicate'],
      ['Lock', 'selection', 'toggleLock'],
      ['Bring forward', 'arrange', 'bringForward'],
      ['Send backward', 'arrange', 'sendBackward'],
      ['Bring to front', 'arrange', 'bringToFront'],
      ['Send to back', 'arrange', 'sendToBack'],
      ['Group', 'arrange', 'group'],
      ['Ungroup', 'arrange', 'ungroup'],
      ['Delete', 'selection', 'delete'],
    ] as const;
    for (const [label, type, command] of expected) {
      const entry = entries.find((candidate) => candidate.id === label);
      expect(entry?.kind).toBe('item');
      if (entry?.kind !== 'item') throw new Error(`Missing ${label}`);
      expect(entry.isDisabled).not.toBe(true);
      entry.onSelect?.();
      expect(dispatch).toHaveBeenLastCalledWith({ type, command });
    }
    expect(dispatch).toHaveBeenCalledTimes(expected.length);
    const last = entries.at(-1);
    expect(last?.id).toBe('Delete');
    expect(last?.kind === 'item' && last.isDanger).toBe(true);
  });

  it('omits unavailable actions and limits a fully locked selection to unlocking', () => {
    const dispatch = vi.fn();
    const entries = selectionMoreEntries(
      [selected('a', 'shape', true), selected('b', 'group', true)],
      SHORTCUTS,
      dispatch,
    );
    const items = entries.filter((entry): entry is MenuItemEntry => entry.kind === 'item');
    // Item 2: old not-available rows are omitted without shell capabilities.
    expect(items.map((item) => item.label)).toEqual(['Unlock']);
    items[0]?.onSelect?.();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'selection', command: 'toggleLock' });
  });

  it('offers Group only for multiple objects and Ungroup only with a selected group', () => {
    const labels = (selection: BoardObject[]): string[] =>
      selectionMoreEntries(selection, SHORTCUTS, vi.fn()).map((entry) => entry.id);
    expect(labels([selected('one')])).not.toContain('Group');
    expect(labels([selected('one')])).not.toContain('Ungroup');
    expect(labels([selected('one'), selected('two')])).toContain('Group');
    expect(labels([selected('one'), selected('two')])).not.toContain('Ungroup');
    expect(labels([selected('group', 'group')])).toContain('Ungroup');
  });
});

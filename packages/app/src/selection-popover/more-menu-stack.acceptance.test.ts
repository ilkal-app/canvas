// Item 4: the More menu exposes stacking only for one unlocked sticky.
import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';

import { selectionMoreEntries } from './more-menu.js';

const SHORTCUTS = createFloatingShortcutRegistry('other');

/**
 * A selection fixture with only the fields this menu reads.
 *
 * @param id - The object id.
 * @param type - Sticky or shape.
 * @param isLocked - Whether the object is locked.
 * @returns The menu selection object.
 */
function object(id: string, type: 'sticky' | 'shape', isLocked = false): BoardObject {
  return { id: id as ObjectId, type, locked: isLocked } as unknown as BoardObject;
}

describe('Add note below in the selection More menu', () => {
  it.each([
    ['mac', '⇧N'],
    ['other', 'Shift+N'],
  ] as const)(
    'shows %s shortcut for one unlocked sticky and dispatches the stack command',
    (platform, shortcut) => {
      const dispatch = vi.fn();
      const entries = selectionMoreEntries(
        [object('note', 'sticky')],
        createFloatingShortcutRegistry(platform),
        dispatch,
      );
      const matches = entries.filter((entry) => entry.id === 'Add note below');
      expect(matches).toHaveLength(1);
      const [entry] = matches;
      expect(entry).toMatchObject({
        kind: 'item',
        label: 'Add note below',
        meta: shortcut,
      });
      if (entry?.kind === 'separator') throw new Error('Expected a menu item.');
      entry?.onSelect?.();
      expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'arrange', command: 'stackSticky' });
    },
  );

  it.each([
    ['a shape', [object('shape', 'shape')]],
    ['two stickies', [object('first', 'sticky'), object('second', 'sticky')]],
    ['a locked sticky', [object('locked', 'sticky', true)]],
  ])('omits the action for %s', (label, selection) => {
    const entries = selectionMoreEntries(selection, SHORTCUTS, vi.fn());
    expect(
      entries.some((entry) => entry.id === 'Add note below'),
      label,
    ).toBe(false);
  });
});

// Item 2, written before the code. CONTRACT: selection Export and Copy link use offered callbacks, including when locked. Deliberately not asserted: menu animation or download encoding.
import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { MenuEntry, MenuItemEntry } from '../controls/menu.js';
import { createDefaultShortcutRegistry } from '../keymap/default-keymap.js';
import type { FloatingBoardExport } from '../shell/floating-board-menu.js';
import type { ShellAction } from '../state/shell-action.js';

import { selectionMoreEntries } from './more-menu.js';

const SHORTCUTS = createDefaultShortcutRegistry('mac');
// The fourth argument is the proposed contract. A three-argument function can be assigned to
// this shape before implementation; runtime proves whether it uses the extra argument.
const menuWithMore: (
  selection: readonly BoardObject[],
  shortcuts: typeof SHORTCUTS,
  dispatch: (action: ShellAction) => void,
  more?: { readonly export?: FloatingBoardExport | 'pending'; readonly onCopyLink?: () => void },
) => readonly MenuEntry[] = selectionMoreEntries;

function selected(isLocked = false): BoardObject {
  return { id: 'first' as ObjectId, type: 'shape', locked: isLocked } as BoardObject;
}

function item(
  entries: readonly { readonly id: string; readonly kind: string }[],
  id: string,
): MenuItemEntry {
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry?.kind !== 'item') throw new Error(`Missing ${id}`);
  return entry as MenuItemEntry;
}

function items(entries: readonly MenuEntry[]): MenuItemEntry[] {
  return entries.filter((entry): entry is MenuItemEntry => entry.kind === 'item');
}

describe('selection More capabilities', () => {
  it('offers the board menu Export submenu for a selection and calls each exporter', () => {
    const onExport = vi.fn();
    const entries = menuWithMore([selected()], SHORTCUTS, vi.fn(), {
      export: { scope: 'selection', onExport },
    });
    const exported = item(entries, 'export');
    expect(exported.label).toBe('Export');
    expect(exported.meta).toBe('PNG, PDF');
    expect(exported.isDisabled).not.toBe(true);
    const submenu = exported.submenu ?? [];
    expect(items(submenu).map((entry) => [entry.label, entry.meta])).toEqual([
      ['PNG 1×', 'Selection'],
      ['PNG 2×', 'Selection'],
      ['PDF', 'Selection'],
    ]);
    for (const entry of submenu) if (entry.kind === 'item') entry.onSelect?.();
    expect(onExport.mock.calls).toEqual([
      ['png', 1],
      ['png', 2],
      ['pdf', 2],
    ]);
  });

  it('copies through the shell callback and keeps Copy link, Unlock and Export on a locked selection', () => {
    const onCopyLink = vi.fn();
    const onExport = vi.fn();
    const dispatch = vi.fn();
    const entries = menuWithMore([selected(true)], SHORTCUTS, dispatch, {
      onCopyLink,
      export: { scope: 'selection', onExport },
    });
    expect(items(entries).map((entry) => entry.label)).toEqual([
      'Copy link to object',
      'Unlock',
      'Export',
    ]);
    item(entries, 'Copy link to object').onSelect?.();
    item(entries, 'Unlock').onSelect?.();
    const exported = item(entries, 'export');
    const png = exported.submenu?.find(
      (entry) => entry.kind === 'item' && entry.label === 'PNG 1×',
    );
    if (png?.kind === 'item') png.onSelect?.();
    expect(onCopyLink).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'selection', command: 'toggleLock' });
    expect(onExport).toHaveBeenCalledExactlyOnceWith('png', 1);
  });

  it('omits missing capabilities and keeps a pending exporter disabled', () => {
    const absent = selectionMoreEntries([selected()], SHORTCUTS, vi.fn());
    expect(items(absent).map((entry) => entry.label)).not.toContain('Copy link to object');
    expect(items(absent).map((entry) => entry.label)).not.toContain('Export');
    const pending = menuWithMore([selected()], SHORTCUTS, vi.fn(), {
      export: 'pending',
    });
    const exported = item(pending, 'export');
    expect(exported.label).toBe('Export');
    expect(exported.meta).toBe('PNG, PDF');
    expect(exported.isDisabled).toBe(true);
    expect(exported.submenu).toBeUndefined();
  });
});

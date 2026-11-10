// CONTRACT: reserves Export and resolved comments rows before their actions are ready.
import { describe, expect, it, vi } from 'vitest';

import { floatingBoardMenuEntries, type FloatingBoardMenuInput } from './floating-board-menu.js';

const INPUT: FloatingBoardMenuInput = {
  host: { onRename: vi.fn(), onDuplicate: vi.fn(), onVersionHistory: vi.fn() },
  onNavigateHome: vi.fn(),
  themePreference: 'system',
  onThemeChange: vi.fn(),
  onKeyboardShortcuts: vi.fn(),
  openUrl: vi.fn(),
  help: { docsUrl: '/help', feedbackUrl: 'mailto:feedback@example.com' },
};

describe('pending floating board menu entries', () => {
  it('reserves a disabled Export row with the same id and separators as ready Export', () => {
    const pending = floatingBoardMenuEntries({ ...INPUT, export: 'pending' });
    const ready = floatingBoardMenuEntries({
      ...INPUT,
      export: { scope: 'board', onExport: vi.fn() },
    });
    const absent = floatingBoardMenuEntries(INPUT);
    expect(pending.map(({ id }) => id)).toEqual(ready.map(({ id }) => id));
    expect(pending.map(({ kind }) => kind)).toEqual(ready.map(({ kind }) => kind));
    expect(pending.map(({ id }) => id)).toEqual([
      'all-boards',
      'separator-1',
      'rename',
      'duplicate',
      'export',
      'version-history',
      'separator-2',
      'theme',
      'keyboard-shortcuts',
      'help',
    ]);
    expect(pending.find(({ id }) => id === 'export')).toEqual({
      kind: 'item',
      id: 'export',
      label: 'Export',
      meta: 'PNG, PDF',
      isDisabled: true,
    });
    const readyExport = ready.find(({ id }) => id === 'export');
    expect(readyExport).toMatchObject({ kind: 'item', id: 'export' });
    expect(readyExport?.kind === 'item' && Array.isArray(readyExport.submenu)).toBe(true);
    expect(absent.some(({ id }) => id === 'export')).toBe(false);
  });

  it('reserves an unchecked disabled checkbox without an unread row', () => {
    const pending = floatingBoardMenuEntries({ ...INPUT, comments: 'pending' });
    const ready = floatingBoardMenuEntries({
      ...INPUT,
      comments: { isResolvedShown: true, onToggleResolved: vi.fn() },
    });
    expect(pending.map(({ id }) => id)).toEqual(ready.map(({ id }) => id));
    expect(pending.map(({ kind }) => kind)).toEqual(ready.map(({ kind }) => kind));
    expect(pending.find(({ id }) => id === 'show-resolved-comments')).toEqual({
      kind: 'checkbox',
      id: 'show-resolved-comments',
      label: 'Show resolved comments',
      isDisabled: true,
      isChecked: false,
    });
    expect(pending.some(({ id }) => id === 'unread-comments')).toBe(false);
    const readyComments = ready.find(({ id }) => id === 'show-resolved-comments');
    expect(readyComments).toMatchObject({ isChecked: true });
    expect(readyComments?.kind !== 'separator' && typeof readyComments?.onSelect).toBe('function');
    expect(floatingBoardMenuEntries(INPUT).some(({ id }) => id === 'show-resolved-comments')).toBe(
      false,
    );
  });

  it('keeps both pending rows and every separator at fixed indices when both become ready', () => {
    const pending = floatingBoardMenuEntries({ ...INPUT, export: 'pending', comments: 'pending' });
    const ready = floatingBoardMenuEntries({
      ...INPUT,
      export: { scope: 'selection', onExport: vi.fn() },
      comments: { isResolvedShown: false, onToggleResolved: vi.fn() },
    });
    expect(pending.map(({ id }) => id)).toEqual(ready.map(({ id }) => id));
    expect(pending.map(({ kind }) => kind)).toEqual(ready.map(({ kind }) => kind));
    expect(pending.map(({ id }) => id)).toEqual([
      'all-boards',
      'separator-1',
      'rename',
      'duplicate',
      'export',
      'version-history',
      'separator-2',
      'show-resolved-comments',
      'separator-3',
      'theme',
      'keyboard-shortcuts',
      'help',
    ]);
  });

  it('adds only the known unread row above the resolved checkbox after comments load', () => {
    const pending = floatingBoardMenuEntries({ ...INPUT, comments: 'pending' });
    const ready = floatingBoardMenuEntries({
      ...INPUT,
      comments: {
        isResolvedShown: false,
        onToggleResolved: vi.fn(),
        unread: { threads: 2, mentions: 1 },
        onOpenUnread: vi.fn(),
      },
    });
    expect(ready.map(({ id }) => id).filter((id) => id !== 'unread-comments')).toEqual(
      pending.map(({ id }) => id),
    );
    const unreadIndex = ready.findIndex(({ id }) => id === 'unread-comments');
    expect(ready[unreadIndex + 1]?.id).toBe('show-resolved-comments');
  });
});

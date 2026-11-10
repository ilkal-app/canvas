import { expect, it, vi } from 'vitest';

import { floatingBoardMenuEntries } from './floating-board-menu.js';

it('keeps Show resolved comments in the compact menu beside Search board', () => {
  const onToggleResolved = vi.fn();
  const entries = floatingBoardMenuEntries({
    host: undefined,
    onNavigateHome: vi.fn(),
    themePreference: 'system',
    onThemeChange: vi.fn(),
    onKeyboardShortcuts: vi.fn(),
    openUrl: vi.fn(),
    isCompact: true,
    onSearch: vi.fn(),
    comments: { isResolvedShown: false, onToggleResolved },
  });
  const ids = entries.flatMap((entry) => (entry.kind === 'separator' ? [] : [entry.id]));
  expect(ids.slice(0, 3)).toEqual(['all-boards', 'search', 'show-resolved-comments']);
  const resolved = entries.find(
    (entry) => entry.kind !== 'separator' && entry.id === 'show-resolved-comments',
  );
  expect(resolved).toMatchObject({ kind: 'checkbox', isChecked: false });
});

it('keeps Duplicate board for an owner or editor in the compact menu', () => {
  const entries = floatingBoardMenuEntries({
    host: { onDuplicate: vi.fn(), onRename: vi.fn() },
    onNavigateHome: vi.fn(),
    themePreference: 'system',
    onThemeChange: vi.fn(),
    onKeyboardShortcuts: vi.fn(),
    openUrl: vi.fn(),
    isCompact: true,
    onSearch: vi.fn(),
  });
  const ids = entries.flatMap((entry) => (entry.kind === 'separator' ? [] : [entry.id]));
  expect(ids.slice(0, 4)).toEqual(['all-boards', 'search', 'rename', 'duplicate']);
});

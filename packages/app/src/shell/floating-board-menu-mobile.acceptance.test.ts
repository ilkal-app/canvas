// Search is immediately after All boards, or first without a home action.
import { expect, it, vi } from 'vitest';

import { floatingBoardMenuEntries } from './floating-board-menu.js';

it('offers compact Search in order and routes its action; desktop omits it', () => {
  const onSearch = vi.fn();
  const input = {
    host: undefined,
    onNavigateHome: vi.fn(),
    themePreference: 'system' as const,
    onThemeChange: vi.fn(),
    onKeyboardShortcuts: vi.fn(),
    openUrl: vi.fn(),
    isCompact: true,
    onSearch,
  };
  const entries = floatingBoardMenuEntries(input);
  expect(
    entries
      .filter((entry) => entry.kind !== 'separator')
      .slice(0, 2)
      .map((entry) => entry.label),
  ).toEqual(['All boards', 'Search board']);
  const search = entries.find(
    (entry) => entry.kind !== 'separator' && entry.label === 'Search board',
  );
  expect(search).toMatchObject({ kind: 'item', label: 'Search board' });
  if (search?.kind === 'item') search.onSelect?.();
  expect(onSearch).toHaveBeenCalledOnce();
  const noHome = floatingBoardMenuEntries({ ...input, onNavigateHome: undefined });
  expect(noHome[0]).toMatchObject({ kind: 'item', label: 'Search board' });
  const desktopInput = { ...input, isCompact: false };
  const desktop = floatingBoardMenuEntries(desktopInput);
  expect(
    desktop.some((entry) => entry.kind !== 'separator' && entry.label === 'Search board'),
  ).toBe(false);
});

// CONTRACT: the floating board menu counts only unread threads, names mentions, and
// omits its entry when nothing is unread.
import { describe, expect, it, vi } from 'vitest';

import { floatingBoardMenuEntries } from './floating-board-menu.js';

const INPUT = {
  host: {},
  onNavigateHome: undefined,
  themePreference: 'system' as const,
  onThemeChange: vi.fn(),
  onKeyboardShortcuts: vi.fn(),
  openUrl: vi.fn(),
};

function unreadEntry(threads: number, mentions: number) {
  return floatingBoardMenuEntries({
    ...INPUT,
    comments: {
      isResolvedShown: false,
      onToggleResolved: vi.fn(),
      onOpenUnread: vi.fn(),
      unread: { threads, mentions },
    },
  }).find((entry) => entry.id === 'unread-comments');
}

describe('floating menu unread acceptance', () => {
  it('has no unread entry at zero', () => {
    expect(unreadEntry(0, 0)).toBeUndefined();
  });
  it('shows a plain count for unread comments without mentions', () => {
    expect(unreadEntry(1, 0)).toMatchObject({ label: 'Unread comments', meta: '1' });
  });
  it('shows both counts when unread comments mention the person', () => {
    expect(unreadEntry(4, 2)).toMatchObject({
      label: 'Unread comments and mentions',
      meta: '4 · @2',
    });
  });
});

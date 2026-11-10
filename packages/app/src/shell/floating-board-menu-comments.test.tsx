// @vitest-environment jsdom
// The floating board menu's "Show resolved comments": with no threads panel under the
// floating chrome, it shows or hides resolved threads' pins, checked while they show.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { commentContext, type CommentMode } from '../comments/comment-context.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';

import { AppShell } from './app-shell.js';
import { floatingBoardMenuEntries } from './floating-board-menu.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** The floating menu's input with no host actions. */
const INPUT = {
  host: {},
  onNavigateHome: undefined,
  themePreference: 'system' as const,
  onThemeChange: vi.fn(),
  onKeyboardShortcuts: vi.fn(),
  openUrl: vi.fn(),
};

/**
 * The floating shell under a comment mode, its board menu opened.
 *
 * @param mode - The comment mode; none (a board without site comments) if absent.
 * @param boardMode - The board's mode; Whiteboard if absent.
 * @returns The menu.
 */
function openMenu(mode?: CommentMode, boardMode: 'whiteboard' | 'uiux' = 'whiteboard') {
  const shell = (
    <AppShell
      platform="mac"
      mode={boardMode}
      mountEngine={createFakeMount().mount}
      boardBar={{ homeHref: '/', onNavigateHome: vi.fn(), floatingMenu: {} }}
    />
  );
  render(
    mode === undefined ? (
      shell
    ) : (
      <commentContext.Provider value={mode}>{shell}</commentContext.Provider>
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
  return screen.getByRole('menu', { name: 'Board menu' });
}

describe('floatingBoardMenuEntries', () => {
  it('adds the resolved comments checkbox after Version history, separated', () => {
    const onToggleResolved = vi.fn();
    const entries = floatingBoardMenuEntries({
      ...INPUT,
      host: { onVersionHistory: vi.fn() },
      comments: { isResolvedShown: true, onToggleResolved },
    });
    const at = entries.findIndex((entry) => entry.id === 'show-resolved-comments');
    expect(entries.slice(at - 2, at).map((entry) => entry.kind)).toEqual(['item', 'separator']);
    expect(entries[at - 2]?.id).toBe('version-history');
    expect(entries[at]).toMatchObject({
      kind: 'checkbox',
      isChecked: true,
      onSelect: onToggleResolved,
    });
    expect(
      floatingBoardMenuEntries(INPUT).some((entry) => entry.id === 'show-resolved-comments'),
    ).toBe(false);
  });
});

describe('floatingBoardMenuEntries, unread comments', () => {
  it('counts unread threads before the resolved toggle, naming mentions, while any is unread', () => {
    const onOpenUnread = vi.fn();
    const entries = (unread: { threads: number; mentions: number }) =>
      floatingBoardMenuEntries({
        ...INPUT,
        comments: { isResolvedShown: false, onToggleResolved: vi.fn(), unread, onOpenUnread },
      });
    const plain = entries({ threads: 3, mentions: 0 });
    const at = plain.findIndex((entry) => entry.id === 'unread-comments');
    expect(plain[at]).toMatchObject({ kind: 'item', label: 'Unread comments', meta: '3' });
    expect(plain[at + 1]?.id).toBe('show-resolved-comments');
    expect(
      entries({ threads: 2, mentions: 1 }).find((entry) => entry.id === 'unread-comments'),
    ).toMatchObject({ label: 'Unread comments and mentions', meta: '2 · @1' });
    const none = entries({ threads: 0, mentions: 0 });
    expect(none.some((entry) => entry.id === 'unread-comments')).toBe(false);
    const item = plain[at];
    if (item?.kind !== 'item') throw new Error('No item.');
    item.onSelect?.();
    expect(onOpenUnread).toHaveBeenCalledOnce();
  });

  it('has no count without a way to open the next unread thread', () => {
    const entries = floatingBoardMenuEntries({
      ...INPUT,
      comments: {
        isResolvedShown: false,
        onToggleResolved: vi.fn(),
        unread: { threads: 2, mentions: 0 },
      },
    });
    expect(entries.some((entry) => entry.id === 'unread-comments')).toBe(false);
  });
});

describe('the floating board menu’s comments', () => {
  it('shows or hides resolved comments from the menu, checked while they show', () => {
    const mode: CommentMode = {
      canWrite: true,
      isPlacing: false,
      isPanelOpen: false,
      setPlacing: vi.fn(),
      togglePanel: vi.fn(),
      isResolvedShown: false,
      toggleResolvedShown: vi.fn(),
    };
    const menu = openMenu(mode);
    const item = within(menu).getByRole('menuitemcheckbox', { name: 'Show resolved comments' });
    expect(item.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(item);
    expect(mode.toggleResolvedShown).toHaveBeenCalledOnce();
    cleanup();
    const shown = openMenu({ ...mode, isResolvedShown: true });
    expect(
      within(shown)
        .getByRole('menuitemcheckbox', { name: 'Show resolved comments' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('has none in a mode with the right-hand drawer, which keeps the classic menu (review; D1)', () => {
    const menu = openMenu(
      {
        canWrite: true,
        isPlacing: false,
        isPanelOpen: false,
        setPlacing: vi.fn(),
        togglePanel: vi.fn(),
        isResolvedShown: false,
        toggleResolvedShown: vi.fn(),
      },
      'uiux',
    );
    // A UI / UX board keeps the classic chrome under the floating one (D1), whose
    // menu has its own Comments checkbox; resolved pins never hide there.
    expect(
      within(menu).queryByRole('menuitemcheckbox', { name: 'Show resolved comments' }),
    ).toBeNull();
  });

  it('marks the checked checkbox with a check, as a compact menu marks its choice (review)', () => {
    const menu = openMenu({
      canWrite: true,
      isPlacing: false,
      isPanelOpen: false,
      setPlacing: vi.fn(),
      togglePanel: vi.fn(),
      isResolvedShown: true,
      toggleResolvedShown: vi.fn(),
    });
    const item = within(menu).getByRole('menuitemcheckbox', { name: 'Show resolved comments' });
    expect(item.querySelector('svg')).not.toBeNull();
  });

  it('has none on a board without site comments, or a mode without the toggle', () => {
    expect(within(openMenu()).queryByRole('menuitemcheckbox')).toBeNull();
    cleanup();
    const menu = openMenu({
      canWrite: true,
      isPlacing: false,
      isPanelOpen: false,
      setPlacing: vi.fn(),
      togglePanel: vi.fn(),
    });
    expect(within(menu).queryByRole('menuitemcheckbox')).toBeNull();
  });
});

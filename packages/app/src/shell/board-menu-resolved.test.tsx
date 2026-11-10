// @vitest-environment jsdom
// The board menu's comment entry under the floating whiteboard chrome: no threads
// panel, so "Show resolved comments" shows or hides resolved pins instead.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { commentContext, type CommentMode } from '../comments/comment-context.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';

import { BoardMenu } from './board-menu.js';
import { shellBoardModeContext, type ShellBoardMode } from './shell-board-mode.js';

afterEach(cleanup);

/** The floating whiteboard's shell mode: no drawers. */
const FLOATING: ShellBoardMode = {
  mode: 'whiteboard',
  changeMode: () => undefined,
  drawers: { hasLayersDrawer: false, hasInspector: false },
};

/**
 * The board menu under a comment mode and the shell's mode, opened.
 *
 * @param mode - The comment mode.
 * @param shell - The shell's mode; outside a shell (both drawers) if absent.
 * @returns The menu.
 */
function openMenu(mode: CommentMode, shell?: ShellBoardMode) {
  const menu: ReactElement = (
    <commentContext.Provider value={mode}>
      <BoardMenu
        actions={[]}
        state={INITIAL_SHELL_STATE}
        themePreference="system"
        dispatch={vi.fn()}
        onThemeChange={vi.fn()}
      />
    </commentContext.Provider>
  );
  render(
    shell === undefined ? (
      menu
    ) : (
      <shellBoardModeContext.Provider value={shell}>{menu}</shellBoardModeContext.Provider>
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
  return screen.getByRole('menu', { name: 'Board menu' });
}

/**
 * A comment mode with its toggles spied on.
 *
 * @param fields - What differs.
 * @returns The mode.
 */
function commentMode(fields: Partial<CommentMode> = {}): CommentMode {
  return {
    canWrite: true,
    isPlacing: false,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
    isResolvedShown: false,
    toggleResolvedShown: vi.fn(),
    ...fields,
  };
}

describe('the board menu’s comment entry', () => {
  it('shows or hides resolved pins under the floating whiteboard chrome, checked while shown', () => {
    const mode = commentMode();
    const menu = openMenu(mode, FLOATING);
    expect(within(menu).queryByRole('menuitemcheckbox', { name: 'Comments' })).toBeNull();
    const item = within(menu).getByRole('menuitemcheckbox', { name: 'Show resolved comments' });
    expect(item.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(item);
    expect(mode.toggleResolvedShown).toHaveBeenCalledOnce();
    // Choosing it closes the menu.
    expect(screen.queryByRole('menu', { name: 'Board menu' })).toBeNull();
    cleanup();
    const shown = openMenu(commentMode({ isResolvedShown: true }), FLOATING);
    expect(
      within(shown)
        .getByRole('menuitemcheckbox', { name: 'Show resolved comments' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('keeps the threads panel’s toggle with the right-hand drawer, and no resolved toggle', () => {
    const menu = openMenu(commentMode());
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Comments' })).toBeTruthy();
    expect(
      within(menu).queryByRole('menuitemcheckbox', { name: 'Show resolved comments' }),
    ).toBeNull();
  });

  it('has no comment entry, nor its separator, where the mode cannot show resolved pins', () => {
    const menu = openMenu(
      {
        canWrite: true,
        isPlacing: false,
        isPanelOpen: false,
        setPlacing: vi.fn(),
        togglePanel: vi.fn(),
      },
      FLOATING,
    );
    expect(within(menu).queryByRole('menuitemcheckbox', { name: /resolved/ })).toBeNull();
    // The first separator is the theme's, after the shortcut sheet.
    const first = menu.querySelector('[role="separator"]');
    expect(first?.previousElementSibling?.textContent).toContain('Keyboard shortcuts');
  });
});

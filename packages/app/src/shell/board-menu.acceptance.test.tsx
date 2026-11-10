// @vitest-environment jsdom
// CONTRACT: resolved-pin visibility is reversible and available to viewers; the drawer keeps Comments.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { commentContext, type CommentMode } from '../comments/comment-context.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';

import { BoardMenu } from './board-menu.js';
import { shellBoardModeContext, type ShellBoardMode } from './shell-board-mode.js';

afterEach(cleanup);

function menu(mode: CommentMode, hasInspector: boolean) {
  const shell: ShellBoardMode = {
    mode: 'whiteboard',
    changeMode: () => undefined,
    drawers: { hasLayersDrawer: hasInspector, hasInspector },
  };
  return render(
    <shellBoardModeContext.Provider value={shell}>
      <commentContext.Provider value={mode}>
        <BoardMenu
          actions={[]}
          state={INITIAL_SHELL_STATE}
          themePreference="system"
          dispatch={vi.fn()}
          onThemeChange={vi.fn()}
        />
      </commentContext.Provider>
    </shellBoardModeContext.Provider>,
  );
}

function mode(canWrite: boolean): CommentMode {
  return {
    canWrite,
    isPlacing: false,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
    isResolvedShown: false,
    toggleResolvedShown: vi.fn(),
  };
}

it('lets a viewer show and then hide resolved pins by checking twice', () => {
  let current = mode(false);
  const view = menu(current, false);
  const clickToggle = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
    const item = within(screen.getByRole('menu', { name: 'Board menu' })).getByRole(
      'menuitemcheckbox',
      { name: 'Show resolved comments' },
    );
    const wasChecked = item.getAttribute('aria-checked');
    fireEvent.click(item);
    return wasChecked;
  };
  expect(clickToggle()).toBe('false');
  expect(current.toggleResolvedShown).toHaveBeenCalledOnce();
  current = { ...current, isResolvedShown: true };
  view.rerender(
    <shellBoardModeContext.Provider
      value={{
        mode: 'whiteboard',
        changeMode: () => undefined,
        drawers: { hasLayersDrawer: false, hasInspector: false },
      }}
    >
      <commentContext.Provider value={current}>
        <BoardMenu
          actions={[]}
          state={INITIAL_SHELL_STATE}
          themePreference="system"
          dispatch={vi.fn()}
          onThemeChange={vi.fn()}
        />
      </commentContext.Provider>
    </shellBoardModeContext.Provider>,
  );
  expect(clickToggle()).toBe('true');
  expect(current.toggleResolvedShown).toHaveBeenCalledTimes(2);
  current = { ...current, isResolvedShown: false };
  view.rerender(
    <shellBoardModeContext.Provider
      value={{
        mode: 'whiteboard',
        changeMode: () => undefined,
        drawers: { hasLayersDrawer: false, hasInspector: false },
      }}
    >
      <commentContext.Provider value={current}>
        <BoardMenu
          actions={[]}
          state={INITIAL_SHELL_STATE}
          themePreference="system"
          dispatch={vi.fn()}
          onThemeChange={vi.fn()}
        />
      </commentContext.Provider>
    </shellBoardModeContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
  expect(
    within(screen.getByRole('menu', { name: 'Board menu' }))
      .getByRole('menuitemcheckbox', { name: 'Show resolved comments' })
      .getAttribute('aria-checked'),
  ).toBe('false');
});

it('keeps Comments and omits resolved visibility when the right-hand drawer exists', () => {
  menu(mode(false), true);
  fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
  const entries = within(screen.getByRole('menu', { name: 'Board menu' }));
  expect(entries.getByRole('menuitemcheckbox', { name: 'Comments' })).toBeTruthy();
  expect(entries.queryByRole('menuitemcheckbox', { name: 'Show resolved comments' })).toBeNull();
});

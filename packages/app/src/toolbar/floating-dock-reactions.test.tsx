// @vitest-environment jsdom
// The floating dock's Reactions opens the board's reactions flyout, shown pressed while
// it is open, in the tool panel's place.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { commentContext } from '../comments/comment-context.js';
import { createFloatingShortcutRegistry } from '../keymap/floating-keymap.js';
import { boardReactions } from '../reactions/__fixtures__/board-reactions.js';
import { reactionsContext, type BoardReactions } from '../reactions/reactions-context.js';
import type { ShellAction } from '../state/shell-action.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';

import { writer } from './__fixtures__/render-dock.js';
import { FloatingDock } from './floating-dock.js';

afterEach(cleanup);

/**
 * The dock of an editor whose sticky tool is active (its panel open), under the reactions.
 *
 * @param reactions - The board's reactions.
 * @returns The shell's dispatch.
 */
function show(reactions: BoardReactions) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  render(
    <commentContext.Provider value={writer()}>
      <reactionsContext.Provider value={reactions}>
        <FloatingDock
          registry={createFloatingShortcutRegistry('mac')}
          state={{ ...INITIAL_SHELL_STATE, canEdit: true, activeTool: 'sticky' }}
          dispatch={dispatch}
        />
      </reactionsContext.Provider>
    </commentContext.Provider>,
  );
  return dispatch;
}

it('dispatches Reactions’ action, shown with its key E', () => {
  const dispatch = show(boardReactions({ isOpen: false }));
  const button = screen.getByRole('button', { name: /^Reactions/ });
  expect(button.getAttribute('aria-keyshortcuts')).toBe('E');
  fireEvent.click(button);
  expect(dispatch).toHaveBeenCalledWith({ type: 'toggleReactions' });
  expect(screen.queryByRole('toolbar', { name: 'Reactions' })).toBeNull();
  expect(screen.getByRole('toolbar', { name: 'Sticky note options' })).toBeTruthy();
});

it('shows Reactions pressed and its flyout in the tool panel’s place while open', () => {
  show(boardReactions({ isOpen: true }));
  const button = screen.getByRole('button', { name: /^Reactions/ });
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('toolbar', { name: 'Reactions' })).toBeTruthy();
  expect(screen.queryByRole('toolbar', { name: 'Sticky note options' })).toBeNull();
});

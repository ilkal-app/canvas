// @vitest-environment jsdom
// The comment key beside the shell's dispatch: M toggles the site's comment placement
// for a member who may write, choosing a tool stops a placement, and every action still reaches
// the shell.
import { cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { commentContext, type CommentMode } from '../comments/comment-context.js';
import type { ShellAction } from '../state/shell-action.js';

import { useCommentKeyDispatch } from './use-comment-key-dispatch.js';
import { isFloatingDockShown } from './use-floating-dock.js';

afterEach(cleanup);

/**
 * A comment mode whose placement calls are recorded.
 *
 * @param mode - Its fields.
 * @returns The mode, and its recorded `setPlacing`.
 */
function commentMode(mode: Partial<Pick<CommentMode, 'isPlacing' | 'canWrite'>>) {
  const setPlacing = vi.fn<(value: boolean) => void>();
  const value: CommentMode = {
    isPlacing: false,
    canWrite: true,
    isPanelOpen: false,
    setPlacing,
    togglePanel: vi.fn(),
    ...mode,
  };
  return { value, setPlacing };
}

/**
 * Renders the hook under a comment mode.
 *
 * @param mode - The comment mode, or none.
 * @param canEdit - Whether the person may edit; true if absent.
 * @returns The dispatch it gives and the shell's.
 */
function render(mode: CommentMode | undefined, canEdit = true) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <commentContext.Provider value={mode}>{children}</commentContext.Provider>
  );
  const { result } = renderHook(
    () => useCommentKeyDispatch(dispatch, { canEdit, activeTool: 'select' }),
    {
      wrapper,
    },
  );
  return { keyDispatch: result.current, dispatch };
}

describe('useCommentKeyDispatch', () => {
  it('toggles placement for a writer and passes the action on', () => {
    const mode = commentMode({ isPlacing: false });
    const { keyDispatch, dispatch } = render(mode.value);
    keyDispatch({ type: 'toggleCommentPlacing' });
    expect(mode.setPlacing).toHaveBeenCalledWith(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleCommentPlacing' });
  });

  it('stops a placement under way when a tool is chosen', () => {
    const mode = commentMode({ isPlacing: true });
    const { keyDispatch } = render(mode.value);
    keyDispatch({ type: 'selectTool', tool: 'text' });
    expect(mode.setPlacing).toHaveBeenCalledWith(false);
  });

  it('starts placing for a commenter, who cannot edit but writes comments', () => {
    const commenter = commentMode({ canWrite: true });
    const { keyDispatch, dispatch } = render(commenter.value, false);
    keyDispatch({ type: 'toggleCommentPlacing' });
    expect(commenter.setPlacing).toHaveBeenCalledWith(true);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('does nothing to comments for a reader or without site comments', () => {
    const reader = commentMode({ canWrite: false });
    render(reader.value).keyDispatch({ type: 'toggleCommentPlacing' });
    expect(reader.setPlacing).not.toHaveBeenCalled();
    const { keyDispatch, dispatch } = render(undefined);
    keyDispatch({ type: 'toggleCommentPlacing' });
    expect(dispatch).toHaveBeenCalledOnce();
  });
});

describe('isFloatingDockShown', () => {
  it('is true only for a whiteboard under the floating chrome', () => {
    expect(isFloatingDockShown('floating', 'whiteboard')).toBe(true);
    expect(isFloatingDockShown('floating', 'uiux')).toBe(false);
    expect(isFloatingDockShown('classic', 'whiteboard')).toBe(false);
    expect(isFloatingDockShown('floating', undefined)).toBe(false);
  });
});

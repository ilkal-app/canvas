// CONTRACT: a writable commenter toggles placement with M, while viewers cannot.
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

import { commentContext, type CommentMode } from '../comments/comment-context.js';
import { boardReactions } from '../reactions/__fixtures__/board-reactions.js';
import { reactionsContext } from '../reactions/reactions-context.js';
import { DRAW_ERASER_KEY_ACTION } from '../state/floating-dock-actions.js';
import type { ShellAction } from '../state/shell-action.js';

import { useCommentKeyDispatch } from './use-comment-key-dispatch.js';

it('uses E as eraser while drawing and closes Reactions on tool choice', () => {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const reactions = boardReactions({ isOpen: true, armed: '👍' });
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <reactionsContext.Provider value={reactions}>{children}</reactionsContext.Provider>
  );
  const { result } = renderHook(
    () => useCommentKeyDispatch(dispatch, { canEdit: true, activeTool: 'draw' }),
    { wrapper },
  );
  result.current({ type: 'toggleReactions', isKey: true });
  expect(dispatch).toHaveBeenCalledWith(DRAW_ERASER_KEY_ACTION);
  expect(reactions.toggle).not.toHaveBeenCalled();
  result.current({ type: 'selectTool', tool: 'select' });
  expect(reactions.close).toHaveBeenCalledExactlyOnceWith();
});

it('starts and stops commenter comment placement through M when comments can write', () => {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const setPlacing = vi.fn<(value: boolean) => void>();
  let mode: CommentMode = {
    isPlacing: false,
    canWrite: true,
    isPanelOpen: false,
    setPlacing,
    togglePanel: vi.fn(),
  };
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <commentContext.Provider value={mode}>{children}</commentContext.Provider>
  );
  const { result, rerender } = renderHook(
    () => useCommentKeyDispatch(dispatch, { canEdit: false, activeTool: 'select' }),
    { wrapper },
  );
  act(() => {
    result.current({ type: 'toggleCommentPlacing' });
  });
  expect(setPlacing).toHaveBeenCalledExactlyOnceWith(true);
  expect(dispatch).toHaveBeenCalledWith({ type: 'toggleCommentPlacing' });
  mode = { ...mode, isPlacing: true };
  rerender();
  act(() => {
    result.current({ type: 'toggleCommentPlacing' });
  });
  expect(setPlacing).toHaveBeenLastCalledWith(false);
});

it('ignores M for a viewer whose comments cannot write', () => {
  const setPlacing = vi.fn();
  const mode: CommentMode = {
    isPlacing: false,
    canWrite: false,
    isPanelOpen: false,
    setPlacing,
    togglePanel: vi.fn(),
  };
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <commentContext.Provider value={mode}>{children}</commentContext.Provider>
  );
  const { result } = renderHook(
    () => useCommentKeyDispatch(vi.fn(), { canEdit: false, activeTool: 'select' }),
    { wrapper },
  );
  act(() => {
    result.current({ type: 'toggleCommentPlacing' });
  });
  expect(setPlacing).not.toHaveBeenCalled();
});

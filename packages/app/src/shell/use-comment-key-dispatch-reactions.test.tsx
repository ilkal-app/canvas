// @vitest-environment jsdom
// The Reactions key beside the shell's dispatch: Reactions and its E open and close the
// flyout for anyone who may react, E while drawing is the eraser, and choosing a tool or placing a
// comment closes the flyout.
import { cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolId } from '@canvas/tools';

import { commentContext, type CommentMode } from '../comments/comment-context.js';
import { boardReactions } from '../reactions/__fixtures__/board-reactions.js';
import { reactionsContext, type BoardReactions } from '../reactions/reactions-context.js';
import { DRAW_ERASER_KEY_ACTION } from '../state/floating-dock-actions.js';
import type { ShellAction } from '../state/shell-action.js';

import { useCommentKeyDispatch } from './use-comment-key-dispatch.js';

afterEach(cleanup);

/**
 * Renders the hook under the board's reactions and a comment mode.
 *
 * @param reactions - The reactions.
 * @param activeTool - The active tool.
 * @param isPlacing - Whether a comment is being placed.
 * @returns The dispatch it gives, the shell's, and the comment mode's `setPlacing`.
 */
function render(reactions: BoardReactions | undefined, activeTool: ToolId, isPlacing = false) {
  const dispatch = vi.fn<(action: ShellAction) => void>();
  const setPlacing = vi.fn<(value: boolean) => void>();
  const mode = { isPlacing, canWrite: true, setPlacing } as unknown as CommentMode;
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <commentContext.Provider value={mode}>
      <reactionsContext.Provider value={reactions}>{children}</reactionsContext.Provider>
    </commentContext.Provider>
  );
  const { result } = renderHook(
    () => useCommentKeyDispatch(dispatch, { canEdit: true, activeTool }),
    { wrapper },
  );
  return { keyDispatch: result.current, dispatch, setPlacing };
}

describe('useCommentKeyDispatch with reactions', () => {
  it('toggles the flyout from the button and from E, stopping a comment placement', () => {
    const reactions = boardReactions();
    const f = render(reactions, 'select', true);
    f.keyDispatch({ type: 'toggleReactions' });
    f.keyDispatch({ type: 'toggleReactions', isKey: true });
    expect(reactions.toggle).toHaveBeenCalledTimes(2);
    expect(f.setPlacing).toHaveBeenCalledWith(false);
    expect(f.dispatch).toHaveBeenCalledWith({ type: 'toggleReactions' });
  });

  it('makes E the eraser while drawing, while the Reactions button still opens the flyout', () => {
    const reactions = boardReactions();
    const f = render(reactions, 'draw');
    f.keyDispatch({ type: 'toggleReactions', isKey: true });
    expect(f.dispatch).toHaveBeenCalledWith(DRAW_ERASER_KEY_ACTION);
    expect(reactions.toggle).not.toHaveBeenCalled();
    f.keyDispatch({ type: 'toggleReactions' });
    expect(reactions.toggle).toHaveBeenCalledTimes(1);
  });

  it('closes the flyout when a tool is chosen (a mode, Image’s panel, Draw by P) or a comment is placed', () => {
    const reactions = boardReactions();
    const f = render(reactions, 'select');
    f.keyDispatch({ type: 'selectTool', tool: 'sticky' });
    f.keyDispatch({ type: 'openToolPanel', panel: 'image' });
    f.keyDispatch({ type: 'toolPanelKey', tool: 'draw', key: 'cycle', shouldChooseTool: true });
    f.keyDispatch({ type: 'toggleCommentPlacing' });
    expect(reactions.close).toHaveBeenCalledTimes(4);
    // A panel key that chooses no tool (the eraser while drawing) leaves it.
    f.keyDispatch({ type: 'toolPanelKey', tool: 'draw', key: 'eraser', shouldChooseTool: false });
    expect(reactions.close).toHaveBeenCalledTimes(4);
  });

  it('opens nothing for a viewer, or on a board without reactions', () => {
    const viewer = boardReactions({ canReact: false });
    render(viewer, 'select').keyDispatch({ type: 'toggleReactions' });
    expect(viewer.toggle).not.toHaveBeenCalled();
    const none = render(undefined, 'select');
    none.keyDispatch({ type: 'toggleReactions' });
    none.keyDispatch({ type: 'selectTool', tool: 'sticky' });
    expect(none.dispatch).toHaveBeenCalledTimes(2);
  });
});

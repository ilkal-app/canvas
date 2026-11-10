import { useCallback } from 'react';

import { useCommentMode } from '../comments/comment-context.js';
import { useBoardReactions } from '../reactions/reactions-context.js';
import { DRAW_ERASER_KEY_ACTION } from '../state/floating-dock-actions.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';

/**
 * Whether an action chooses a tool: its mode (`selectTool`), a panel tool without one (Image's
 * `openToolPanel`), or Draw by its panel key (P).
 *
 * @param action - The action.
 * @returns True when it does.
 */
function choosesTool(action: ShellAction): boolean {
  if (action.type === 'selectTool' || action.type === 'openToolPanel') return true;
  return action.type === 'toolPanelKey' && action.shouldChooseTool;
}

/**
 * The shell's dispatch with the comment and reactions keys:
 * `toggleCommentPlacing` (the floating dock's M) starts or stops the site's comment placement
 * for a member who may write comments (a commenter too since: a pin is the comments
 * service's, not the document's), and does nothing elsewhere. `toggleReactions` (Reactions and its E) opens
 * or closes the reactions flyout for anyone who may react, but E while drawing chooses the
 * eraser instead. Choosing a tool (a mode, Image's panel or Draw by P) stops a
 * placement under way and closes the flyout,
 * as the dock's buttons do; one of the two opening closes the other. Every action still reaches
 * `dispatch`. Main thread.
 *
 * @param dispatch - The shell's dispatch.
 * @param state - The active tool (and whether the person may edit the board, which Comment no
 *   longer asks since).
 * @returns The dispatch the shortcuts and the dock use.
 */
export function useCommentKeyDispatch(
  dispatch: (action: ShellAction) => void,
  state: Pick<ShellState, 'canEdit' | 'activeTool'>,
): (action: ShellAction) => void {
  const comments = useCommentMode();
  const reactions = useBoardReactions();
  const { activeTool } = state;
  return useCallback(
    (action: ShellAction) => {
      if (action.type === 'toggleReactions' && action.isKey === true && activeTool === 'draw') {
        dispatch(DRAW_ERASER_KEY_ACTION);
        return;
      }
      if (action.type === 'toggleReactions') {
        if (reactions?.canReact === true) reactions.toggle();
        if (comments?.isPlacing === true) comments.setPlacing(false);
      } else if (action.type === 'toggleCommentPlacing') {
        if (comments?.canWrite === true) comments.setPlacing(!comments.isPlacing);
        reactions?.close();
      } else if (choosesTool(action)) {
        if (comments?.isPlacing === true) comments.setPlacing(false);
        reactions?.close();
      }
      dispatch(action);
    },
    [activeTool, comments, reactions, dispatch],
  );
}

import { createContext, useContext } from 'react';

import type { UnreadComments } from './comment-unread.js';

/** State shared by the comment toolbar control and canvas overlay. */
export interface CommentMode {
  /** Whether the next canvas click places a comment. */
  readonly isPlacing: boolean;
  /** Whether this member may write. */
  readonly canWrite: boolean;
  /** Whether the panel is visible. */
  readonly isPanelOpen: boolean;
  /** Chooses or cancels pin placement. */
  setPlacing(value: boolean): void;
  /** Toggles the thread panel. */
  togglePanel(): void;
  /**
   * Whether resolved threads' pins show under the floating whiteboard chrome, where
   * they hide unless the board menu shows them; absent, they show.
   */
  readonly isResolvedShown?: boolean;
  /**
   * How many open threads are unread for the person, and how many mention them: the
   * floating dock's dot on Comment and the board menu's count; none if absent.
   */
  readonly unread?: UnreadComments | undefined;
  /** Shows or hides resolved threads' pins (the board menu's "Show resolved comments"). */
  readonly toggleResolvedShown?: () => void;
}
/** Optional site comments; standalone canvases have no relational threads. */
export const commentContext = createContext<CommentMode | undefined>(undefined);
/**
 * Whether a board's comments are on their way: its comments provider waits for the
 * board's connection, so there is no comment mode yet, but there will be. False where there are
 * no site comments at all, and once they are here or the session ended.
 */
export const commentsPendingContext = createContext(false);

/**
 * Reads optional comments controls.
 *
 * @returns Controls on a signed-in board, otherwise undefined.
 */
export function useCommentMode(): CommentMode | undefined {
  return useContext(commentContext);
}

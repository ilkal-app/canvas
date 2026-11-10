import { useCallback } from 'react';

import { contextMenuSelectionOf } from '../context-menu/context-menu-entries.js';
import type { ContextMenuRequest, MountedEngine } from '../engine/mounted-engine.js';
import { useIsMobileSite } from '../shell/mobile-site.js';
import { useWhiteboardChrome } from '../shell/whiteboard-chrome.js';

import { useBoardReactions } from './reactions-context.js';

// A long-press on the canvas on a phone under the floating whiteboard chrome: on empty
// board it opens the reactions sheet, as the ticket asks ("reactions: long-press on the canvas");
// on an object it keeps the context menu.

/** What decides where a long-press goes. */
export interface LongPressReactionsOptions {
  /** Whether the floating whiteboard chrome shows. */
  readonly isFloating: boolean;
  /** Whether the viewport is a phone's (below 768 px wide). */
  readonly isCompact: boolean;
  /** How many objects are selected after the press (none: it landed on empty board). */
  readonly selectedCount: number;
  /** Whether the person may send reactions (an editor or a commenter). */
  readonly canReact: boolean;
}

/**
 * Whether a long-press opens the reactions sheet instead of the context menu: on a phone under
 * the floating chrome, on empty board, for someone who may react. Pure.
 *
 * @param options - The chrome, the viewport, the selection after the press and the role.
 * @returns True for the reactions sheet.
 */
export function longPressOpensReactions(options: LongPressReactionsOptions): boolean {
  return options.isFloating && options.isCompact && options.selectedCount === 0 && options.canReact;
}

/**
 * The shell's context-menu request with the phone's long-press for reactions in front
 * ({@link longPressOpensReactions}), for a finger's long-press only (a secondary click keeps the
 * menu): the reactions sheet opens (if it is not open already), else the context menu does. Main
 * thread.
 *
 * @param openContextMenu - Opens the context menu.
 * @returns Where a context-menu request from the canvas goes.
 */
export function useLongPressReactions(
  openContextMenu: (request: ContextMenuRequest, engine: MountedEngine) => void,
): (request: ContextMenuRequest, engine: MountedEngine) => void {
  const isFloating = useWhiteboardChrome() === 'floating';
  const isCompact = useIsMobileSite();
  const reactions = useBoardReactions();
  return useCallback(
    (request, engine) => {
      // A finger's long-press only: a secondary click keeps the menu at any width.
      const isReaction =
        request.isTouch === true &&
        longPressOpensReactions({
          isFloating,
          isCompact,
          selectedCount: contextMenuSelectionOf(engine.inspect()).count,
          canReact: reactions?.canReact === true,
        });
      if (!isReaction) openContextMenu(request, engine);
      else if (reactions?.isOpen !== true) reactions?.toggle();
    },
    [isFloating, isCompact, reactions, openContextMenu],
  );
}

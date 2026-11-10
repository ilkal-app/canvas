import { useCallback, useState } from 'react';

import type { BoardMode } from '@canvas/schema';

import { DEFAULT_BOARD_MODE } from '../state/dock-layout.js';

/** The board's mode as the shell shows it, and how the switcher changes it. */
export interface BoardModeBinding {
  /** The mode whose tools the dock offers. */
  readonly mode: BoardMode;
  /** Called with the mode chosen in the switcher. */
  readonly changeMode: (mode: BoardMode) => void;
}

/**
 * The board's mode for the dock: the host's (`AppShellProps.mode`, the site's board
 * record), or one the shell keeps itself, Whiteboard to start, where the host gives none (the
 * standalone shell, the playground). A change goes to the host's `onModeChange` (the site saves
 * it on the board, `changeBoardMode`) and is kept locally either way, so the dock follows at
 * once; nothing in the board's document changes.
 *
 * @param mode - The host's mode, if it has one.
 * @param onModeChange - The host's handler, if any.
 * @returns The mode and its change.
 */
export function useBoardMode(
  mode: BoardMode | undefined,
  onModeChange: ((mode: BoardMode) => void) | undefined,
): BoardModeBinding {
  const [localMode, setLocalMode] = useState<BoardMode>(mode ?? DEFAULT_BOARD_MODE);
  const changeMode = useCallback(
    (next: BoardMode) => {
      setLocalMode(next);
      onModeChange?.(next);
    },
    [onModeChange],
  );
  return { mode: mode ?? localMode, changeMode };
}

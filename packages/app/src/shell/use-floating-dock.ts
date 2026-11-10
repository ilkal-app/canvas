import { useContext } from 'react';

import type { BoardMode } from '@canvas/schema';

import { shellBoardModeContext } from './shell-board-mode.js';
import { useWhiteboardChrome, type WhiteboardChrome } from './whiteboard-chrome.js';

/**
 * Whether the shell shows the floating whiteboard dock: a whiteboard board under the
 * floating chrome. Any other board mode keeps its classic dock. Pure.
 *
 * @param chrome - The shell's chrome.
 * @param mode - The board's mode; none outside a shell.
 * @returns True for the floating dock.
 */
export function isFloatingDockShown(
  chrome: WhiteboardChrome,
  mode: BoardMode | undefined,
): boolean {
  return chrome === 'floating' && mode === 'whiteboard';
}

/**
 * Whether this shell shows the floating whiteboard dock, from its chrome and its board mode
 * (`shellBoardModeContext`).
 *
 * @returns True for the floating dock.
 */
export function useIsFloatingDock(): boolean {
  const chrome = useWhiteboardChrome();
  return isFloatingDockShown(chrome, useContext(shellBoardModeContext)?.mode);
}

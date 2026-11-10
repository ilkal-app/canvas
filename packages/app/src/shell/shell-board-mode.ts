import { createContext, useContext, useMemo } from 'react';

import type { BoardMode } from '@canvas/schema';

import { panelLayoutFor, type PanelLayout } from '../state/dock-layout.js';
import type { ShellAction } from '../state/shell-action.js';

import { useBoardMode, type BoardModeBinding } from './use-board-mode.js';
import type { WhiteboardChrome } from './whiteboard-chrome.js';

/** The board's mode as the whole shell shows it, and which drawers it has. */
export interface ShellBoardMode extends BoardModeBinding {
  /** The drawers the mode has under the shell's chrome (`panelLayoutFor`). */
  readonly drawers: PanelLayout;
}

/**
 * The shell's board mode and drawers (`AppShell` provides them); undefined outside a shell, where
 * a component keeps its own mode and has both drawers.
 */
export const shellBoardModeContext = createContext<ShellBoardMode | undefined>(undefined);

/** Both drawers, as every mode has them under the classic chrome. */
const BOTH_DRAWERS = panelLayoutFor('whiteboard', 'classic');

/**
 * The board's mode for the whole shell (`useBoardMode`: the host's, else the shell's own,
 * Whiteboard to start) and the drawers it has under the shell's chrome, for `AppShell` to
 * provide, so the dock, the workspace and the board menu agree on one mode.
 *
 * @param mode - The host's mode, if it has one.
 * @param onModeChange - The host's handler, if any.
 * @param chrome - The shell's chrome.
 * @returns The mode, its change and the drawers.
 */
export function useShellBoardModeValue(
  mode: BoardMode | undefined,
  onModeChange: ((mode: BoardMode) => void) | undefined,
  chrome: WhiteboardChrome,
): ShellBoardMode {
  const { mode: shown, changeMode } = useBoardMode(mode, onModeChange);
  return useMemo(
    () => ({
      mode: shown,
      changeMode,
      drawers: panelLayoutFor(shown, chrome),
    }),
    [shown, changeMode, chrome],
  );
}

/**
 * The drawers of the shell this component is in: under the floating chrome a whiteboard board
 * has neither the layers drawer nor the inspector; both outside a shell.
 *
 * @returns The drawers.
 */
export function useShellDrawers(): PanelLayout {
  return useContext(shellBoardModeContext)?.drawers ?? BOTH_DRAWERS;
}

/**
 * Whether an action asks for a drawer the shell does not have (alt+1's `toggleLayersDrawer`,
 * alt+8's `toggleInspector` on a whiteboard board under the floating chrome): the
 * shell then says so instead (`NOT_IN_WHITEBOARD_NOTICE`). Pure.
 *
 * @param action - The action.
 * @param drawers - The shell's drawers.
 * @returns True when the action's drawer is missing.
 */
export function isMissingDrawer(action: ShellAction, drawers: PanelLayout): boolean {
  if (action.type === 'toggleLayersDrawer') return !drawers.hasLayersDrawer;
  if (action.type === 'toggleInspector') return !drawers.hasInspector;
  return false;
}

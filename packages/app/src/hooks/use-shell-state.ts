import { useEffect, useReducer, useRef } from 'react';

import { loadLayersDrawerOpen, saveLayersDrawerOpen } from '../state/layers-drawer-preference.js';
import type { ShellAction } from '../state/shell-action.js';
import { INITIAL_SHELL_STATE, shellReducer, type ShellState } from '../state/shell-reducer.js';
import { subscribeViewPreferenceRequests } from '../state/view-preference-channel.js';
import {
  loadViewPreferences,
  saveViewPreferences,
  type ViewPreferences,
} from '../state/view-preferences.js';

/**
 * The shell's first state, with the person's view preferences from their last visit.
 *
 * @param initial - The shell's default state, with whether the person may edit.
 * @returns It with the stored grid and snapping preferences and whether the layers drawer was
 *   left open.
 */
function withStoredPreferences(initial: ShellState): ShellState {
  return { ...initial, ...loadViewPreferences(), isLayersDrawerOpen: loadLayersDrawerOpen() };
}

/**
 * The shell's state and dispatch (`shellReducer`), starting from the person's stored view
 * preferences (the grid, snapping; whether a delete takes attached connectors: whether the
 * layers drawer is open) and keeping them in the browser's storage for the next visit. It writes
 * only when one changes: storage holds what was loaded, then what was last written, so mounting the
 * shell never stores the defaults. It starts read-only when told the person cannot edit,
 * so a viewer's shell never shows a creation tool.
 *
 * @param canEdit - Whether the person may edit the board when the shell mounts; true if absent.
 * @returns The state and the reducer's dispatch.
 */
export function useShellState(
  canEdit = true,
): readonly [ShellState, (action: ShellAction) => void] {
  const [state, dispatch] = useReducer(
    shellReducer,
    { ...INITIAL_SHELL_STATE, canEdit },
    withStoredPreferences,
  );
  const { isGridVisible, isSnappingOn, shouldDeleteConnectors } = state;
  const storedRef = useRef<ViewPreferences>({
    isGridVisible,
    isSnappingOn,
    shouldDeleteConnectors,
  });
  useEffect(() => {
    const stored = storedRef.current;
    if (
      stored.isGridVisible === isGridVisible &&
      stored.isSnappingOn === isSnappingOn &&
      stored.shouldDeleteConnectors === shouldDeleteConnectors
    )
      return;
    storedRef.current = { isGridVisible, isSnappingOn, shouldDeleteConnectors };
    saveViewPreferences(storedRef.current);
  }, [isGridVisible, isSnappingOn, shouldDeleteConnectors]);
  useStoredLayersDrawer(state.isLayersDrawerOpen);
  useViewPreferenceRequests(state, dispatch);
  return [state, dispatch];
}

/**
 * Keeps whether the layers drawer is open for the next visit, writing only when it
 * changes, as the view preferences are.
 *
 * @param isOpen - Whether it is open now.
 */
function useStoredLayersDrawer(isOpen: boolean): void {
  const storedRef = useRef(isOpen);
  useEffect(() => {
    if (storedRef.current === isOpen) return;
    storedRef.current = isOpen;
    saveLayersDrawerOpen(isOpen);
  }, [isOpen]);
}

/**
 * Applies requests to change the view preferences from outside the shell (Board
 * settings, `requestViewPreferences`): each field that differs from the state goes through the
 * shell's own toggle, as its shortcut does, so the engine and storage follow one path.
 *
 * @param state - The shell's state.
 * @param dispatch - Its dispatch.
 */
function useViewPreferenceRequests(
  state: ShellState,
  dispatch: (action: ShellAction) => void,
): void {
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(
    () =>
      subscribeViewPreferenceRequests((request) => {
        const current = stateRef.current;
        if (
          request.isGridVisible !== undefined &&
          request.isGridVisible !== current.isGridVisible
        ) {
          dispatch({ type: 'navigate', command: 'toggleGrid' });
        }
        if (request.isSnappingOn !== undefined && request.isSnappingOn !== current.isSnappingOn) {
          dispatch({ type: 'navigate', command: 'toggleSnapping' });
        }
      }),
    [dispatch],
  );
}

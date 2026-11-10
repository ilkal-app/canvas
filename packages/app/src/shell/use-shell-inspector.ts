import { useCallback, type RefObject } from 'react';

import type { PanelModel } from '../panels/use-panel-model.js';
import { matchShortcut, type ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';

import { useDrawerSlot } from './drawer-slot.js';
import { useInspectorDrawer, type InspectorDrawerBinding } from './inspector-drawer.js';
import { useIsMobileSite } from './mobile-site.js';
import { isMissingDrawer, useShellDrawers } from './shell-board-mode.js';
import { NOT_IN_WHITEBOARD_NOTICE } from './whiteboard-chrome.js';

/**
 * The inspector drawer (`useInspectorDrawer`) on the page's right-hand drawer slot
 * (`useDrawerSlot`), opening for a selection or a creation tool's style (below 768 px wide, for a
 * selection only:), and the dispatch the shortcuts and the harness use: the drawer takes
 * `toggleInspector` (alt+8), the reducer the rest. Where the shell has no such drawer (a
 * whiteboard board under the floating chrome) the inspector never opens, and
 * `toggleInspector` and `toggleLayersDrawer` show `NOT_IN_WHITEBOARD_NOTICE` instead.
 *
 * @param panels - What the panels show: the style context and the selection.
 * @param layout - The shell state as the layout shows it, for whether the person may edit.
 * @param shell - The shell's root, whose focus the canvas takes back, and its shortcuts, whose
 *   `toggleInspector` chord the drawer takes from its own fields.
 * @param shell.rootRef - The root.
 * @param shell.registry - The shortcuts.
 * @param shell.showNotice - Shows the shell's notice.
 * @param reducerDispatch - The reducer's dispatch.
 * @returns The drawer and the dispatch.
 */
export function useShellInspector(
  panels: PanelModel,
  layout: ShellState,
  shell: {
    readonly rootRef: RefObject<HTMLDivElement | null>;
    readonly registry: ShortcutRegistry<ShellAction>;
    readonly showNotice: (message: string) => void;
  },
  reducerDispatch: (action: ShellAction) => void,
): { readonly drawer: InspectorDrawerBinding; readonly dispatch: (action: ShellAction) => void } {
  const { selectedIds } = panels.board;
  const drawers = useShellDrawers();
  // Below 768 px wide the sheet would cover the compact bar: it opens for a selection only,
  // not for a creation tool's style.
  const isCompact = useIsMobileSite();
  const drawer = useInspectorDrawer({
    subjectKey: `${panels.context}:${selectedIds.join(',')}`,
    hasSubject: selectedIds.length > 0 || (!isCompact && panels.context !== 'none'),
    canEdit: layout.canEdit && drawers.hasInspector,
    slot: useDrawerSlot(),
    rootRef: shell.rootRef,
    isToggleKey: (event) => matchShortcut(event, shell.registry)?.action.type === 'toggleInspector',
  });
  const { toggleFromKeyboard } = drawer;
  const { showNotice } = shell;
  const dispatch = useCallback(
    (action: ShellAction) => {
      if (isMissingDrawer(action, drawers)) showNotice(NOT_IN_WHITEBOARD_NOTICE);
      else if (action.type === 'toggleInspector') toggleFromKeyboard();
      else reducerDispatch(action);
    },
    [drawers, showNotice, toggleFromKeyboard, reducerDispatch],
  );
  return { drawer, dispatch };
}

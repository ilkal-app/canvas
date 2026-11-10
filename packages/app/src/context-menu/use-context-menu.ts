import { useCallback, useState } from 'react';

import type { ContextMenuRequest, MountedEngine } from '../engine/mounted-engine.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';

import {
  contextMenuSections,
  contextMenuSelectionOf,
  type ContextMenuSection,
} from './context-menu-entries.js';

/** The context menu while it is open: where, and what it offers. */
export interface OpenContextMenu {
  /** Tells one opening from the next, so each opens afresh (focus on its first entry). */
  readonly sequence: number;
  /** Where it opened. */
  readonly position: ContextMenuRequest;
  /** What it offers for the selection it opened on. */
  readonly sections: readonly ContextMenuSection[];
}

/** What {@link useContextMenu} gives the shell. */
export interface ContextMenuState {
  /** The open menu with the function that closes it, or undefined while it is closed. */
  readonly contextMenu: (OpenContextMenu & { readonly onClose: () => void }) | undefined;
  /**
   * Opens the menu where the canvas asked, offering what applies to the engine's selection now
   * (the press has already selected what it landed on); a menu with nothing to offer stays shut.
   */
  readonly openContextMenu: (request: ContextMenuRequest, engine: MountedEngine) => void;
  /** Closes it. */
  readonly closeContextMenu: () => void;
}

/**
 * The shell's context menu state: opened by the canvas (a long-press or
 * a secondary click), filled from the shortcut registry for the selection at that moment, with
 * no editing command for a person who cannot edit.
 *
 * @param registry - The shell's shortcuts.
 * @param canEdit - Whether the person may edit the board.
 * @returns The open menu and the functions that open and close it.
 */
export function useContextMenu(
  registry: ShortcutRegistry<ShellAction>,
  canEdit: boolean,
): ContextMenuState {
  const [contextMenu, setContextMenu] = useState<OpenContextMenu | undefined>(undefined);
  const openContextMenu = useCallback(
    (request: ContextMenuRequest, engine: MountedEngine) => {
      const selection = contextMenuSelectionOf(engine.inspect());
      const sections = contextMenuSections(registry, selection, canEdit);
      if (sections.length === 0) return;
      setContextMenu((open) => ({
        sequence: (open?.sequence ?? 0) + 1,
        position: request,
        sections,
      }));
    },
    [registry, canEdit],
  );
  const closeContextMenu = useCallback(() => {
    setContextMenu(undefined);
  }, []);
  return {
    contextMenu: contextMenu && { ...contextMenu, onClose: closeContextMenu },
    openContextMenu,
    closeContextMenu,
  };
}

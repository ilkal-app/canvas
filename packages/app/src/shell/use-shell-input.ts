import { useSyncExternalStore, type RefObject } from 'react';

import type { BoardConnection } from '../collab/board-connection.js';
import { useIsOutdated } from '../collab/use-is-outdated.js';
import { useClipboard } from '../hooks/use-clipboard.js';
import type { MountedEngineBinding } from '../hooks/use-mounted-engine.js';
import { useShortcuts } from '../hooks/use-shortcuts.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import { readFontReplacement, subscribeFontReplacement } from '../text-input/font-replacement.js';

/** What {@link useShellInput} binds. */
export interface ShellInput {
  /** The shell's shortcuts. */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** Runs a shortcut's action. */
  readonly dispatch: (action: ShellAction) => void;
  /** The shell's root, where the clipboard's events are heard. */
  readonly rootRef: RefObject<HTMLDivElement | null>;
  /** The engine, which the clipboard copies from and pastes into. */
  readonly engine: Pick<MountedEngineBinding, 'engineRef'>;
  /** The shell state: whether the cheat sheet is open, the last canvas action, `canEdit`. */
  readonly state: ShellState;
  /** The board's connection, whose `outdated` state makes the layout inert; none if absent. */
  readonly connection?: BoardConnection | undefined;
  /** Whether the host's own dialog is open. */
  readonly isInert?: boolean | undefined;
  /** Whether the board is still loading. */
  readonly isLoading?: boolean | undefined;
}

/**
 * The shell's shortcuts (`useShortcuts`) and clipboard (`useClipboard`; copy only for a person
 * who cannot edit), both off while the layout is inert: the connection is outdated,
 * the cheat sheet is open, the board is loading, or the host says its own dialog is.
 *
 * @param input - The shortcuts, the dispatch, the root, the engine, the state, the connection
 *   and the host's inert flag.
 * @returns Whether the layout is inert.
 */
export function useShellInput(input: ShellInput): boolean {
  const { registry, dispatch, rootRef, engine, state, connection, isInert } = input;
  const replacement = useSyncExternalStore(subscribeFontReplacement, readFontReplacement);
  const isOutdated = useIsOutdated(connection);
  const isLayoutInert =
    replacement !== undefined ||
    isOutdated ||
    state.isCheatSheetOpen ||
    isInert === true ||
    input.isLoading === true;
  useShortcuts(registry, dispatch, !isLayoutInert);
  useClipboard(rootRef, engine.engineRef, state.lastCanvasAction, !isLayoutInert, {
    canEdit: state.canEdit,
  });
  return isLayoutInert;
}

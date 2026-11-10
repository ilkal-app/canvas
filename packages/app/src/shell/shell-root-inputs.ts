import type { CameraInputSignal } from '../collab/use-follow.js';
import { mountDefaultEngine } from '../engine/mount-default-engine.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import type { BoardExporter } from '../export/run-export.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import type { AppShellProps } from './app-shell.js';
import type { UseShellEngineOptions } from './use-shell-engine.js';

/**
 * Reports an engine that cannot start, or its faults, where the host gave no `onEngineError`.
 *
 * @param error - The error.
 */
function reportEngineError(error: unknown): void {
  reportError(error);
}

/** What the shell's engine options need besides its props and state. */
export interface ShellEngineInputs {
  /** Opens the shell's context menu where the canvas asks. */
  readonly onContextMenu: UseShellEngineOptions['onContextMenu'];
  /** The shell's reducer dispatch. */
  readonly dispatch: (action: ShellAction) => void;
  /** The theme shown. */
  readonly theme: { readonly themeName: ThemeName };
}

/**
 * The shell's engine options (`useShellEngine`): the host's mount or `mountDefaultEngine`, its
 * preview start-up, callbacks and error report (`reportError` if absent), and its board.
 *
 * @param props - The shell's props.
 * @param state - The shell state.
 * @param inputs - The context menu, the dispatch and the theme.
 * @param cameraInput - Where the person's own camera moves go (a follow stops on them).
 * @returns The options.
 */
export function shellEngineOptionsOf(
  props: AppShellProps,
  state: ShellState,
  inputs: ShellEngineInputs,
  cameraInput?: CameraInputSignal,
): UseShellEngineOptions {
  const { startEngine, connection } = props;
  return {
    mount: props.mountEngine ?? mountDefaultEngine,
    ...(startEngine === undefined ? {} : { startEngine }),
    onContextMenu: inputs.onContextMenu,
    ...(cameraInput === undefined ? {} : { onCameraInput: cameraInput.emit }),
    state,
    hostCallbacks: props,
    onError: props.onEngineError ?? reportEngineError,
    dispatch: inputs.dispatch,
    themeName: inputs.theme.themeName,
    ...(connection === undefined ? {} : { document: connection }),
  };
}

/**
 * What the shell exports with: the board menu's Export and the selection popover's
 * share it.
 *
 * @param props - The shell's props: the board's name.
 * @param engine - The mounted engine; none before mount.
 * @param themeName - The viewer's theme.
 * @param notify - Shows the shell's notice.
 * @returns The exporter.
 */
export function exporterOf(
  props: AppShellProps,
  engine: MountedEngine | undefined,
  themeName: ThemeName,
  notify: (message: string) => void,
): BoardExporter {
  const { connection } = props;
  return {
    engine,
    images: connection?.images,
    title: boardTitleOf(props),
    themeName,
    notify,
  };
}

/**
 * The board's name as the shell shows it: the host's, else the connection's board id, else
 * `Untitled board`.
 *
 * @param props - The shell's props.
 * @returns The name.
 */
export function boardTitleOf(props: AppShellProps): string {
  return props.boardName ?? props.connection?.status().boardId ?? 'Untitled board';
}

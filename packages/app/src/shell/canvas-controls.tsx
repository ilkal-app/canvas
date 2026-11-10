import { useContext, type ReactElement } from 'react';

import type { BoardMode } from '@canvas/schema';

import type { BoardConnection, ConnectionStatusSource } from '../collab/board-connection.js';
import { isLoadingLiveBoard } from '../collab/connection-label.js';
import { useCanEdit } from '../collab/use-can-edit.js';
import { useConnectionStatus } from '../collab/use-connection-status.js';
import type { CameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { FacilitateCard } from '../facilitation/facilitate-card.js';
import type { BoardTimerSource } from '../facilitation/use-board-timer.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import type { ThemeName } from '../theme/theme-tokens.js';
import { Dock } from '../toolbar/dock.js';
import { FloatingDock } from '../toolbar/floating-dock.js';
import { MobileBar } from '../toolbar/mobile-bar.js';
import { UndoPill } from '../toolbar/undo-pill.js';
import { WhiteboardHint } from '../toolbar/whiteboard-hint.js';
import type { ZoomSource } from '../toolbar/zoom-source.js';

import { CanvasZoom } from './canvas-zoom.js';
import { useIsMobileSite } from './mobile-site.js';
import { shellBoardModeContext } from './shell-board-mode.js';
import { useBoardMode } from './use-board-mode.js';
import { isFloatingDockShown } from './use-floating-dock.js';
import { useSectionFrameNames } from './use-section-frame-names.js';
import { useWhiteboardChrome } from './whiteboard-chrome.js';

/** What the compact bottom bar says while the live board loads (at mobile width). */
export const EDITING_STARTS_LIVE = 'Editing starts when the board is live';

/**
 * The device's storage for the chime's mute, where the page may read it.
 *
 * @returns The storage, or `undefined` where reading it throws (a sandboxed frame).
 */
function deviceStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The board timer's source for the Facilitate card, on a board with a store: a
 * connection's.
 *
 * @param connection - The board's connection, if any.
 * @param connection.store - Its store.
 * @param connection.origin - The person's origin.
 * @param connection.serverClock - The relay's clock.
 * @returns The source, or undefined without a store.
 */
function timerSourceOf(
  connection: Partial<Pick<BoardConnection, 'store' | 'origin' | 'serverClock'>> | undefined,
): BoardTimerSource | undefined {
  if (connection?.store === undefined || connection.origin === undefined) return undefined;
  return {
    store: connection.store,
    origin: connection.origin,
    serverClock: connection.serverClock,
  };
}

/** Props of {@link CanvasControls}. */
export interface CanvasControlsProps {
  /** The shell's shortcuts. */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** The shell state, as the layout shows it. */
  readonly state: ShellState;
  /** The camera's zoom. */
  readonly zoom: ZoomSource;
  /** The camera, which the floating zoom control's minimap shows; no map if absent. */
  readonly camera?: CameraSource | undefined;
  /**
   * The engine: its board, which the floating zoom control's minimap draws, and the page shown;
   * no map if absent.
   */
  readonly engine?: MountedEngine | undefined;
  /** The viewer's theme, which the minimap draws in; light if absent. */
  readonly themeName?: ThemeName | undefined;
  /**
   * The host's board mode and its handler (`AppShellProps.mode`, `onModeChange`), and the board's
   * connection: while the live board loads, the compact bottom bar refuses editing (L1
   * at mobile width); none if absent.
   */
  readonly host: {
    readonly mode?: BoardMode | undefined;
    readonly onModeChange?: ((mode: BoardMode) => void) | undefined;
    readonly connection?:
      | (ConnectionStatusSource &
          Partial<Pick<BoardConnection, 'store' | 'origin' | 'serverClock' | 'remotePresence'>>)
      | undefined;
    readonly isLoading?: boolean | undefined;
  };
  /** The shell's dispatch. */
  readonly dispatch: (action: ShellAction) => void;
}

/**
 * What floats over the canvas: the zoom control over its bottom-left corner, ending
 * with the layers toggle, and the dock over its bottom centre (under the floating
 * whiteboard chrome, the floating zoom control with its minimap,/632, and the floating
 * dock and the Facilitate card at the bottom right), on
 * the board's mode
 * (`useBoardMode`: the host's, else the shell's own, Whiteboard to start). Below 768 px wide
 * the compact forms instead: the compact bottom bar (`MobileBar`), the undo
 * pill above its left end for a person who can edit, and the compact zoom control above its
 * right end; while the live board loads the bar and the undo pill are dimmed and out of reach
 * and the bar says editing starts when it is live (the shell refuses editing meanwhile). Under
 * the floating whiteboard chrome the compact floating dock takes the bar's place, the
 * Facilitate card a pill above its right end, and there is no zoom control (a phone pinches).
 *
 * @param props - The shortcuts, state, zoom, the host's mode and connection, and the dispatch.
 * @returns The controls.
 */
export function CanvasControls(props: CanvasControlsProps): ReactElement {
  const { registry, state, zoom, dispatch } = props;
  const ownMode = useBoardMode(props.host.mode, props.host.onModeChange);
  // The shell's mode (its drawers follow it); the controls' own outside a shell.
  const shellMode = useContext(shellBoardModeContext);
  const { mode, changeMode } = shellMode ?? ownMode;
  const hasLayersDrawer = shellMode?.drawers.hasLayersDrawer ?? true;
  const isCompact = useIsMobileSite();
  const isFloatingDock = isFloatingDockShown(useWhiteboardChrome(), mode);
  const status = useConnectionStatus(props.host.connection);
  const refusal =
    status !== undefined && isLoadingLiveBoard(status) ? EDITING_STARTS_LIVE : undefined;
  // Refused while the live board loads (the shell's `canEdit` is then off), an editor still sees
  // an editor's bar and the undo pill, dimmed and out of reach.
  const canEditByRole = useCanEdit(props.host.connection) && props.host.isLoading !== true;
  const shown = refusal === undefined ? state : { ...state, canEdit: canEditByRole };
  useSectionFrameNames(dispatch, isFloatingDock, state.canEdit);
  const { connection } = props.host;
  const timerSource = timerSourceOf(connection);
  const facilitate =
    timerSource === undefined ? null : (
      <FacilitateCard
        source={timerSource}
        canEdit={canEditByRole}
        storage={deviceStorage()}
        board={props.engine?.board}
      />
    );
  return (
    <>
      <CanvasZoom
        {...{ zoom, registry, dispatch, state, isCompact, hasLayersDrawer, connection }}
        camera={props.camera}
        engine={props.engine}
        themeName={props.themeName}
        isFloating={isFloatingDock}
      />
      {isCompact ? (
        <>
          {shown.canEdit && <UndoPill registry={registry} dispatch={dispatch} refusal={refusal} />}
          {isFloatingDock ? (
            // The floating whiteboard's own dock, compact, and the Facilitate pill before it, so the
            // dock's sheets cover the pill.
            <>
              {facilitate}
              <FloatingDock registry={registry} state={state} dispatch={dispatch} />
            </>
          ) : (
            <MobileBar
              registry={registry}
              state={shown}
              mode={mode}
              onModeChange={changeMode}
              dispatch={dispatch}
              refusal={refusal}
            />
          )}
        </>
      ) : isFloatingDock ? (
        <>
          <FloatingDock registry={registry} state={state} dispatch={dispatch} />
          <WhiteboardHint board={props.engine?.board} state={state} platform={registry.platform} />
          {facilitate}
        </>
      ) : (
        <Dock
          registry={registry}
          state={state}
          mode={mode}
          onModeChange={changeMode}
          dispatch={dispatch}
        />
      )}
    </>
  );
}

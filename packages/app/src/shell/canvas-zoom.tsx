import type { ReactElement } from 'react';

import type { BoardConnection, ConnectionStatusSource } from '../collab/board-connection.js';
import type { CameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { useMinimapPeers } from '../minimap/use-minimap-peers.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import type { ThemeName } from '../theme/theme-tokens.js';
import { FloatingZoom } from '../toolbar/floating-zoom.js';
import { ZoomControl } from '../toolbar/zoom-control.js';
import type { ZoomSource } from '../toolbar/zoom-source.js';

/** Props of {@link CanvasZoom}. */
export interface CanvasZoomProps {
  /** The camera's zoom. */
  readonly zoom: ZoomSource;
  /** The camera, which the minimap shows; no map if absent. */
  readonly camera?: CameraSource | undefined;
  /** The engine: the board the minimap draws, and the page shown; no map if absent. */
  readonly engine?: MountedEngine | undefined;
  /** The board's connection: the collaborators, whose views the map draws. */
  readonly connection?:
    (ConnectionStatusSource & Partial<Pick<BoardConnection, 'remotePresence'>>) | undefined;
  /** The viewer's theme. */
  readonly themeName?: ThemeName | undefined;
  /** The shell state: whether the map is pinned, whether the layers drawer is open. */
  readonly state: Pick<ShellState, 'isMinimapPinned' | 'isLayersDrawerOpen'>;
  /** Whether the shell has a layers drawer, whose toggle the classic control ends with. */
  readonly hasLayersDrawer: boolean;
  /** Whether the floating whiteboard chrome shows. */
  readonly isFloating: boolean;
  /** Whether it is the compact form, below 768 px wide. */
  readonly isCompact: boolean;
  /** The shell's shortcuts. */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** The shell's dispatch. */
  readonly dispatch: (action: ShellAction) => void;
}

/**
 * The zoom control over the canvas: the floating one with its minimap under the floating
 * whiteboard chrome, and none below 768 px wide there, where a phone zooms by
 * pinch; else the classic one.
 *
 * @param props - The zoom, camera, engine, connection, theme, state, form, shortcuts, dispatch.
 * @returns The control.
 */
export function CanvasZoom(props: CanvasZoomProps): ReactElement | null {
  const { zoom, camera, engine, registry, dispatch, state } = props;
  const peers = useMinimapPeers(props.connection, engine);
  const board = engine?.board;
  if (props.isFloating && !props.isCompact) {
    return (
      <FloatingZoom
        {...{ zoom, camera, board, peers, registry, dispatch }}
        themeName={props.themeName}
        isMinimapPinned={state.isMinimapPinned}
      />
    );
  }
  // A phone under the floating chrome zooms by pinch only: no control, no map.
  if (props.isFloating) return null;
  return (
    <ZoomControl
      {...{ zoom, registry, dispatch }}
      {...(props.hasLayersDrawer ? { isLayersDrawerOpen: state.isLayersDrawerOpen } : {})}
      isCompact={props.isCompact}
    />
  );
}

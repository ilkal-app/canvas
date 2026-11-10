import { useSyncExternalStore, type ReactElement } from 'react';

import type { CameraSource } from '../editing/camera-source.js';
import type { BoardView } from '../engine/board-view.js';
import { Icon } from '../icons/icon.js';
import { Minimap, type MinimapPeers } from '../minimap/minimap.js';
import { useCameraMotionPhase } from '../minimap/use-camera-motion.js';
import { POPOVER_AVOID_ATTRIBUTE } from '../selection-popover/reserved-zones.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ThemeName } from '../theme/theme-tokens.js';

import { actionHint } from './action-hints.js';
import dock from './dock.module.css';
import styles from './floating-zoom.module.css';
import { ZOOM_BUTTONS, ZoomButton, zoomPercentOf } from './zoom-control.js';
import { ZoomPresets } from './zoom-presets.js';
import type { ZoomSource } from './zoom-source.js';

/** The minimap toggle's action: the same as its shortcut (shift+m). */
const TOGGLE_MINIMAP: ShellAction = { type: 'navigate', command: 'toggleMinimap' };

/** The row's buttons: the classic control's, with the Library's fit glyph (icon/fit). */
const FLOATING_ZOOM_BUTTONS = ZOOM_BUTTONS.map((button) =>
  button.command === 'zoomToFit' ? { ...button, icon: 'fit' as const } : button,
);

/** Props of {@link FloatingZoom}. */
export interface FloatingZoomProps {
  /** The camera's zoom. */
  readonly zoom: ZoomSource;
  /** The camera, which the map shows and which opens it while it moves; no map if absent. */
  readonly camera?: CameraSource | undefined;
  /** The board the map draws; no map if absent. */
  readonly board?: BoardView | undefined;
  /** The collaborators, whose views the map draws; none if absent. */
  readonly peers?: MinimapPeers | undefined;
  /** The viewer's theme, which the map draws in; light if absent. */
  readonly themeName?: ThemeName | undefined;
  /** Whether the person pinned the map open (the toggle, shift+m). */
  readonly isMinimapPinned: boolean;
  /** The shell's shortcuts, for each button's hint. */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** Receives the buttons' camera actions, the toggle's and the map's pans. */
  readonly dispatch: (action: ShellAction) => void;
}

/**
 * The minimap toggle: pins the map open and closed as shift+m does, pressed while pinned.
 *
 * @param props - Whether the map is pinned, the shortcuts and the dispatch.
 * @param props.isPinned - Whether it is pinned.
 * @param props.registry - The shortcuts.
 * @param props.dispatch - The shell's dispatch.
 * @returns The button.
 */
export function MinimapToggle(props: {
  readonly isPinned: boolean;
  readonly registry: ShortcutRegistry<ShellAction>;
  readonly dispatch: (action: ShellAction) => void;
}): ReactElement {
  const hint = actionHint(props.registry, TOGGLE_MINIMAP);
  return (
    <button
      type="button"
      className={dock.zoomButton}
      aria-label="Minimap"
      aria-pressed={props.isPinned}
      aria-keyshortcuts={hint?.ariaKeyShortcuts}
      title={hint === undefined ? 'Minimap' : `Minimap (${hint.label})`}
      data-minimap-toggle=""
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.dispatch(TOGGLE_MINIMAP);
      }}
    >
      <Icon name="minimap" />
    </button>
  );
}

/**
 * The zoom control under the floating whiteboard chrome (the design board's Whiteboard
 * page), over the canvas's bottom-left corner: zoom out, the zoom (a press opens its presets,
 * `ZoomPresets`), zoom in, zoom to fit, a
 * divider and the minimap toggle, 171 × 38. With a board and a camera it opens into a 232 × 192
 * card, the hint, the minimap and the row, while the map is pinned and while the person
 * pans or zooms (`useCameraMotionPhase`), fading in and, at the end of its linger, out (not under
 * reduced motion). Selection popovers keep clear of it (`data-popover-avoid`).
 *
 * @param props - The zoom, camera, board, whether the map is pinned, the shortcuts and dispatch.
 * @returns The control.
 */
export function FloatingZoom(props: FloatingZoomProps): ReactElement {
  const { registry, dispatch, board, camera, isMinimapPinned } = props;
  const value = useSyncExternalStore(props.zoom.subscribe, props.zoom.read);
  const motion = useCameraMotionPhase(camera);
  const isOpen =
    board !== undefined && camera !== undefined && (isMinimapPinned || motion !== 'still');
  // The map fades in when it opens, and out at the end of its linger unless pinned.
  const isFading = isOpen && !isMinimapPinned && motion === 'fading';
  const [zoomOut, zoomIn, fit] = FLOATING_ZOOM_BUTTONS.map((button) => (
    <ZoomButton key={button.command} {...button} registry={registry} dispatch={dispatch} />
  ));
  const toggle = (
    <MinimapToggle isPinned={isMinimapPinned} registry={registry} dispatch={dispatch} />
  );
  return (
    <div
      role="group"
      aria-label="Zoom"
      className={styles.card}
      data-zoom-control=""
      data-floating-zoom=""
      data-open={isOpen ? '' : undefined}
      {...{ [POPOVER_AVOID_ATTRIBUTE]: '' }}
    >
      {isOpen && (
        <div className={styles.mapArea} data-fading={isFading ? '' : undefined}>
          <p className={styles.hint}>Shows while you pan or zoom</p>
          <Minimap
            board={board}
            camera={camera}
            peers={props.peers}
            dispatch={dispatch}
            themeName={props.themeName ?? 'light'}
          />
        </div>
      )}
      <div className={styles.row}>
        {zoomOut}
        <ZoomPresets zoom={value} camera={camera} dispatch={dispatch}>
          <output className={[dock.zoomValue, styles.value].join(' ')} aria-label="Zoom level">
            {zoomPercentOf(value)}
          </output>
        </ZoomPresets>
        {zoomIn}
        {fit}
        {isOpen ? (
          <span className={styles.spacer} />
        ) : (
          <span className={[dock.zoomDivider, styles.divider].join(' ')} aria-hidden="true" />
        )}
        {toggle}
      </div>
    </div>
  );
}

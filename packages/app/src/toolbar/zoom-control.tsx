import { memo, useSyncExternalStore, type ReactElement } from 'react';

import type { IconName } from '../icons/icon-paths.js';
import { Icon } from '../icons/icon.js';
import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import type { NavigationCommand, ShellAction } from '../state/shell-action.js';

import { actionHint } from './action-hints.js';
import { BOTTOM_CHROME_ATTRIBUTE } from './bottom-chrome.js';
import styles from './dock.module.css';
import type { ZoomSource } from './zoom-source.js';

/** Props of {@link ZoomControl}. */
export interface ZoomControlProps {
  /** The camera's zoom, which the engine writes (`useShellEngine`). */
  readonly zoom: ZoomSource;
  /** The shell's shortcuts, for each button's hint. */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** Receives the buttons' camera actions, and the layers toggle's. */
  readonly dispatch: (action: ShellAction) => void;
  /**
   * Whether the layers drawer is open: the control ends with the layers toggle, pressed
   * while it is, after a divider. No toggle if absent.
   */
  readonly isLayersDrawerOpen?: boolean;
  /**
   * Whether it is the compact form below 768 px wide (the design's "zoom"): over the
   * canvas's bottom-right corner above the compact bottom bar, the zoom and zoom to fit (a pinch
   * zooms), then the layers toggle, as 48 px touch targets. False if absent.
   */
  readonly isCompact?: boolean | undefined;
}

/** The layers toggle's action: the same as its shortcut (alt+1). */
const TOGGLE_LAYERS: ShellAction = { type: 'toggleLayersDrawer' };

/** The control's buttons, in order around the percentage (the floating control's too). */
export const ZOOM_BUTTONS: readonly {
  readonly command: NavigationCommand;
  readonly label: string;
  readonly icon: IconName;
}[] = [
  { command: 'zoomOut', label: 'Zoom out', icon: 'zoom-out' },
  { command: 'zoomIn', label: 'Zoom in', icon: 'zoom-in' },
  { command: 'zoomToFit', label: 'Zoom to fit', icon: 'zoom-fit' },
];

/**
 * The zoom as the control shows it: a whole percentage (`64%`), or an em dash while unknown.
 *
 * @param zoom - The camera's zoom.
 * @returns The text.
 */
export function zoomPercentOf(zoom: number | undefined): string {
  return zoom === undefined ? '—' : `${String(Math.round(zoom * 100))}%`;
}

/**
 * One of the control's buttons: the same camera action as its shortcut, named with it.
 *
 * @param props - The button and where its action goes.
 * @param props.command - The camera command.
 * @param props.label - Its name.
 * @param props.icon - What it shows.
 * @param props.registry - The shortcuts.
 * @param props.dispatch - The shell's dispatch.
 * @returns The button.
 */
export function ZoomButton(props: {
  readonly command: NavigationCommand;
  readonly label: string;
  readonly icon: IconName;
  readonly registry: ShortcutRegistry<ShellAction>;
  readonly dispatch: (action: ShellAction) => void;
}): ReactElement {
  const action: ShellAction = { type: 'navigate', command: props.command };
  const hint = actionHint(props.registry, action);
  return (
    <button
      type="button"
      className={styles.zoomButton}
      aria-label={props.label}
      aria-keyshortcuts={hint?.ariaKeyShortcuts}
      title={hint === undefined ? props.label : `${props.label} (${hint.label})`}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.dispatch(action);
      }}
    >
      <Icon name={props.icon} />
    </button>
  );
}

/**
 * The layers toggle: opens and closes the layers drawer as alt+1 does, pressed while it
 * is open, named with its shortcut.
 *
 * @param props - Whether the drawer is open, the shortcuts and the dispatch.
 * @param props.isOpen - Whether the drawer is open.
 * @param props.registry - The shortcuts.
 * @param props.dispatch - The shell's dispatch.
 * @returns The button.
 */
function LayersToggle(props: {
  readonly isOpen: boolean;
  readonly registry: ShortcutRegistry<ShellAction>;
  readonly dispatch: (action: ShellAction) => void;
}): ReactElement {
  const hint = actionHint(props.registry, TOGGLE_LAYERS);
  return (
    <button
      type="button"
      className={styles.zoomButton}
      aria-label="Layers"
      aria-pressed={props.isOpen}
      aria-keyshortcuts={hint?.ariaKeyShortcuts}
      title={hint === undefined ? 'Layers' : `Layers (${hint.label})`}
      data-layers-toggle=""
      onClick={() => {
        props.dispatch(TOGGLE_LAYERS);
      }}
    >
      <Icon name="layers" />
    </button>
  );
}

/**
 * The zoom control over the canvas's bottom-left corner (Figma "01 · Board at rest"):
 * zoom out, the zoom as a percentage in the mono face, zoom in, and zoom to fit, each button the
 * same camera action as its shortcut; then, given whether the layers drawer is open, a divider and
 * the layers toggle, 171 px in all as the frame has it. Its compact form
 * (`isCompact`) drops zoom out and zoom in.
 *
 * @param props - The zoom, the shortcuts, the dispatch and whether the layers drawer is open.
 * @returns The control.
 */
function ZoomControlView(props: ZoomControlProps): ReactElement {
  const { registry, dispatch, zoom, isLayersDrawerOpen } = props;
  const isCompact = props.isCompact === true;
  const value = useSyncExternalStore(zoom.subscribe, zoom.read);
  const [zoomOut, zoomIn, fit] = ZOOM_BUTTONS.map((button) => (
    <ZoomButton key={button.command} {...button} registry={registry} dispatch={dispatch} />
  ));
  return (
    <div
      role="group"
      aria-label="Zoom"
      className={styles.zoom}
      data-zoom-control=""
      data-compact={isCompact ? '' : undefined}
      {...(isCompact ? { [BOTTOM_CHROME_ATTRIBUTE]: '' } : {})}
    >
      {isCompact ? null : zoomOut}
      <output className={styles.zoomValue} aria-label="Zoom level">
        {zoomPercentOf(value)}
      </output>
      {isCompact ? null : zoomIn}
      {fit}
      {isLayersDrawerOpen === undefined ? null : (
        <>
          <span className={styles.zoomDivider} aria-hidden="true" />
          <LayersToggle isOpen={isLayersDrawerOpen} registry={registry} dispatch={dispatch} />
        </>
      )}
    </div>
  );
}

/** {@link ZoomControlView}: rendered again when the zoom changes, not when the shell does. */
export const ZoomControl = memo(ZoomControlView);

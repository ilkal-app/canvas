import { useRef, useState, type ReactElement, type ReactNode } from 'react';

import { Menu, type MenuEntry } from '../controls/menu.js';
import type { CameraSource } from '../editing/camera-source.js';
import type { ShellAction } from '../state/shell-action.js';

import styles from './floating-zoom.module.css';

/** The zoom levels the preset menu offers, as zoom factors. */
export const ZOOM_PRESETS: readonly number[] = [0.5, 1, 2];

/**
 * What choosing a zoom level does: 100 % is the shortcut's zoom to actual size; another level
 * zooms about the view's centre, as a pinch there, by the factor from the zoom now.
 *
 * @param level - The zoom level wanted.
 * @param camera - The camera, for the zoom now and the view's centre; none if absent.
 * @returns The action, or undefined without a camera (or at 100 %, the shortcut's).
 */
export function zoomPresetAction(
  level: number,
  camera: CameraSource | undefined,
): ShellAction | undefined {
  if (level === 1) return { type: 'navigate', command: 'zoomToActualSize' };
  const now = camera?.read();
  if (now === undefined) return undefined;
  return {
    type: 'zoomCamera',
    centerXPx: now.viewportWidthPx / 2,
    centerYPx: now.viewportHeightPx / 2,
    scale: level / now.zoom,
  };
}

/**
 * The preset menu's entries: 50 %, 100 %, 200 % (the zoom now checked), then Fit and Fit
 * selection (the shortcuts' zoom to fit and zoom to selection).
 *
 * @param zoom - The zoom now, if known.
 * @param camera - The camera.
 * @param dispatch - The shell's dispatch.
 * @returns The entries.
 */
export function zoomPresetEntries(
  zoom: number | undefined,
  camera: CameraSource | undefined,
  dispatch: (action: ShellAction) => void,
): readonly MenuEntry[] {
  const levels = ZOOM_PRESETS.map((level): MenuEntry => {
    const action = zoomPresetAction(level, camera);
    return {
      kind: 'radio',
      id: `zoom-${String(level * 100)}`,
      label: `${String(level * 100)}%`,
      isChecked: zoom !== undefined && Math.abs(zoom - level) < 1e-6,
      isDisabled: action === undefined,
      onSelect: () => {
        if (action !== undefined) dispatch(action);
      },
    };
  });
  const fit = (id: string, label: string, command: 'zoomToFit' | 'zoomToSelection'): MenuEntry => ({
    kind: 'item',
    id,
    label,
    onSelect: () => {
      dispatch({ type: 'navigate', command });
    },
  });
  return [
    ...levels,
    { kind: 'separator', id: 'fits' },
    fit('fit', 'Fit', 'zoomToFit'),
    fit('fit-selection', 'Fit selection', 'zoomToSelection'),
  ];
}

/**
 * The zoom shown in the floating zoom control, a press on which opens the preset menu (
 * "click it for presets"): the zoom stays its own status element, and a transparent button over
 * it opens the menu above the control.
 *
 * @param props - The zoom, the camera, the dispatch, and the zoom's element.
 * @param props.zoom - The zoom now, if known.
 * @param props.camera - The camera.
 * @param props.dispatch - The shell's dispatch.
 * @param props.children - The zoom's element.
 * @returns The zoom with its menu.
 */
export function ZoomPresets(props: {
  readonly zoom: number | undefined;
  readonly camera: CameraSource | undefined;
  readonly dispatch: (action: ShellAction) => void;
  readonly children: ReactNode;
}): ReactElement {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  return (
    <span className={styles.presets}>
      {props.children}
      <button
        ref={buttonRef}
        type="button"
        className={styles.presetsButton}
        aria-label="Zoom presets"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        data-zoom-presets=""
        onClick={() => {
          setOpen(!isOpen);
        }}
      />
      <Menu
        label="Zoom presets"
        entries={zoomPresetEntries(props.zoom, props.camera, props.dispatch)}
        anchor={buttonRef}
        isOpen={isOpen}
        side="top"
        align="start"
        gap={8}
        onClose={() => {
          setOpen(false);
        }}
      />
    </span>
  );
}

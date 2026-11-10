import { useSyncExternalStore, type ReactElement } from 'react';

import { worldToScreen, type Camera } from '@canvas/engine';
import type { OverlayLabel } from '@canvas/tools';

import type { CameraSource } from './camera-source.js';
import type { OverlayLabelFeed } from './overlay-label-feed.js';
import styles from './overlay-labels.module.css';

const NO_LABELS: readonly OverlayLabel[] = Object.freeze([]);

/** The pill's look and side of its anchor for each kind but `gap`, whose side is its axis's. */
const LOOKS: Readonly<Record<Exclude<OverlayLabel['kind'], 'gap'>, string | undefined>> = {
  size: styles.size,
  extent: styles.extent,
  locked: styles.notice,
  connect: styles.connect,
};

/**
 * Subscribes to nothing: the layer stops following the camera while it shows no label.
 *
 * @returns A function that does nothing.
 */
const NO_SUBSCRIPTION = (): (() => void) => () => undefined;

/**
 * The class of a label's pill: its look and which side of its anchor it takes (the
 * size readout 10 px right of the frame's bottom-right corner, bottom-aligned; a gap length 6 px
 * below a horizontal run, or right of a vertical one, centred on it; the locked notice 7 px under
 * the frame's bottom-left corner. E3: a drawn shape's size centred 8 px below it; "Release to
 * connect" 14 px right of and 8 px below the connector's end).
 *
 * @param label - The label.
 * @returns The CSS module classes.
 */
export function labelClassOf(label: OverlayLabel): string {
  const look =
    label.kind === 'gap'
      ? [styles.gap, label.axis === 'y' ? styles.gapAlongY : styles.gapAlongX]
      : [LOOKS[label.kind]];
  return [styles.pill, ...look].filter((name) => name !== undefined).join(' ');
}

/**
 * Where a label's anchor is on the canvas. Pure.
 *
 * @param label - The label.
 * @param camera - The camera on screen.
 * @returns Its anchor, CSS px from the canvas's top-left corner.
 */
export function labelPositionOf(
  label: OverlayLabel,
  camera: Camera,
): { readonly left: number; readonly top: number } {
  const screen = worldToScreen(camera, label.at);
  return { left: screen.x, top: screen.y };
}

/** Props of {@link OverlayLabels}. */
export interface OverlayLabelsProps {
  /** The engine's labels, once it runs. */
  readonly feed: OverlayLabelFeed | undefined;
  /** The camera on screen. */
  readonly camera: CameraSource;
}

/**
 * The editing states' labels over the canvas (Figma "States" E2, E3): the size readout of
 * a resize or of a shape being drawn and each gap run's length in Geist Mono, "Locked · can't move
 * or resize" when a person tries to move a locked selection (announced politely), and "Release to
 * connect" by a connector's end (the numbers and the hint, which change on every step of a drag,
 * are not announced). It renders again only when a label changes or, while one
 * shows, the camera moves; with none it follows nothing. Page.
 *
 * @param props - The labels and the camera.
 * @returns The layer, or nothing while no label shows.
 */
export function OverlayLabels(props: OverlayLabelsProps): ReactElement | null {
  const { feed, camera } = props;
  const labels = useSyncExternalStore(
    (listener) => feed?.subscribe(listener) ?? (() => undefined),
    () => feed?.snapshot() ?? NO_LABELS,
  );
  const view = useSyncExternalStore(
    labels.length > 0 ? camera.subscribe : NO_SUBSCRIPTION,
    camera.read,
  );
  if (labels.length === 0 || view === undefined) return null;
  return (
    <div className={styles.layer} data-overlay-labels="">
      {labels.map((label, index) => {
        const { left, top } = labelPositionOf(label, view);
        const isNotice = label.kind === 'locked';
        return (
          <span
            key={`${label.kind}:${String(index)}`}
            className={labelClassOf(label)}
            style={{ left, top }}
            data-label-kind={label.kind}
            role={isNotice ? 'status' : undefined}
            aria-hidden={isNotice ? undefined : true}
          >
            {label.text}
          </span>
        );
      })}
    </div>
  );
}

import { Fragment, useSyncExternalStore, type ReactElement } from 'react';

import { PEER_CARET_PX, worldToScreen, type Camera, type PeerEditingBox } from '@canvas/engine';

import { avatarColorsOf } from '../collab/avatar-colors.js';
import type { BoardConnection } from '../collab/board-connection.js';
import type { PeerEditingPlacement } from '../engine/mount-peer-editing.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import type { CameraSource } from './camera-source.js';
import styles from './peer-editing.module.css';
import { usePeerEditing, useShareEditing } from './use-peer-editing.js';

/** How far a second tag on one text sits above the first, CSS px: a caption line and a gap. */
const TAG_STEP_PX = 20;

/**
 * Subscribes to nothing: the layer stops following the camera while no peer edits.
 *
 * @returns A function that does nothing.
 */
const NO_SUBSCRIPTION = (): (() => void) => () => undefined;

/**
 * Where a world box lies on the canvas, as CSS: its corner, its size at the zoom and its turn.
 * Pure.
 *
 * @param box - The box, world units.
 * @param camera - The camera on screen.
 * @param widthPx - A screen width instead of the box's own, CSS px.
 * @returns The style.
 */
export function boxStyleOf(
  box: PeerEditingBox,
  camera: Camera,
  widthPx?: number,
): { left: number; top: number; width: number; height: number; transform: string } {
  const corner = worldToScreen(camera, box);
  return {
    left: corner.x,
    top: corner.y,
    width: widthPx ?? box.width * camera.zoom,
    height: box.height * camera.zoom,
    transform: `rotate(${String(box.rotation)}rad)`,
  };
}

/**
 * How many tags already sit on each placement's text before it, so a second peer's tag stacks
 * above the first. Pure.
 *
 * @param placements - The placed peers, in order.
 * @returns Each placement's place in its text's stack, from 0.
 */
export function tagStackOf(placements: readonly PeerEditingPlacement[]): number[] {
  const seen = new Map<string, number>();
  return placements.map(({ objectId }) => {
    const index = seen.get(objectId) ?? 0;
    seen.set(objectId, index + 1);
    return index;
  });
}

/** Props of {@link PeerEditing}. */
export interface PeerEditingProps {
  /** The board's connection: its presence says who edits what, and shares the person's. */
  readonly connection: BoardConnection | undefined;
  /** The engine, once it runs: it draws the marks and reports the person's editing spot. */
  readonly engine: MountedEngine | undefined;
  /** The camera on screen. */
  readonly camera: CameraSource;
  /** Whether the person may edit the board: only then is their own editing shared. */
  readonly canEdit: boolean;
}

/**
 * Peers editing text on the board (Figma "States" E1): the engine outlines the text in
 * the peer's presence colour and draws their caret and selection; this layer adds the
 * "<name> is editing" tag on the text's corner, in the same colour, and transparent markers over
 * the outline (`data-peer-editing-object-id`, `data-presence-color`) and the caret
 * (`data-remote-caret-object-id`), each naming the peer (`data-principal-id`). It also shares in
 * presence where the person edits text, when they may edit (`useShareEditing`). Everything
 * comes from presence and goes with it: when the peer stops, leaves or drops, the marks clear.
 * It follows the camera only while a peer edits. Page.
 *
 * @param props - The connection, engine, camera and whether the person may edit.
 * @returns The layer, or nothing while no peer edits.
 */
export function PeerEditing(props: PeerEditingProps): ReactElement | null {
  const { connection, engine, camera } = props;
  const surface = engine?.peerEditing;
  useShareEditing(surface?.local, connection, props.canEdit);
  const placements = usePeerEditing(connection, surface);
  const view = useSyncExternalStore(
    placements.length > 0 ? camera.subscribe : NO_SUBSCRIPTION,
    camera.read,
  );
  if (placements.length === 0 || view === undefined) return null;
  const stack = tagStackOf(placements);
  return (
    <div className={styles.layer} data-peer-editing-layer="">
      {placements.map((peer, index) => {
        const outline = boxStyleOf(peer.box, view);
        const { fill, ink } = avatarColorsOf(peer.color);
        const step = (stack[index] ?? 0) * TAG_STEP_PX;
        return (
          <Fragment key={`${peer.principalId}:${peer.objectId}:${String(index)}`}>
            <div
              className={styles.outline}
              style={outline}
              data-peer-editing-object-id={peer.objectId}
              data-presence-color={peer.color}
              data-principal-id={peer.principalId}
              aria-hidden="true"
            />
            <span
              className={styles.caret}
              style={boxStyleOf(peer.caret, view, PEER_CARET_PX)}
              data-remote-caret-object-id={peer.objectId}
              data-principal-id={peer.principalId}
              aria-hidden="true"
            />
            <span
              className={styles.tag}
              // The colour is data (the peer's presence colour), so it is set here.
              style={{ left: outline.left, top: outline.top - step, backgroundColor: fill }}
              data-ink={ink}
              data-peer-editing-tag={peer.principalId}
            >
              {`${peer.name} is editing`}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

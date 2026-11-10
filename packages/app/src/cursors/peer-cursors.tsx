import { useEffect, useRef, type ReactElement, type RefObject } from 'react';

import { DEFAULT_PAGE_ID } from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';
import type { CameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { ANIMATION_FRAMES, PeerCursorLayer, type CursorFrames } from './peer-cursor-layer.js';
import { cursorPointOf, peerCursorsOf } from './peer-cursors-model.js';
import styles from './peer-cursors.module.css';

/** The pointers whose position is shared: a finger on a touch screen has no cursor to show. */
const SHARED_POINTERS = new Set(['mouse', 'pen']);

/**
 * Whether the person asked for reduced motion; false where the page cannot tell (no `matchMedia`).
 *
 * @returns True when they did.
 */
function isReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** What {@link useShareCursor} reads the pointer's board position with. */
type CursorEngine = Pick<MountedEngine, 'camera'>;

/** Props of {@link PeerCursors}. */
export interface PeerCursorsProps {
  /** The board's connection: its presence has the peers' cursors and shares the person's. */
  readonly connection: BoardConnection | undefined;
  /** The engine, once it runs: the page shown and the camera. */
  readonly engine: MountedEngine | undefined;
  /** The camera on screen. */
  readonly camera: CameraSource | undefined;
  /** Schedules the cursors' easing; the browser's animation frames by default. */
  readonly frames?: CursorFrames;
}

/**
 * Shares where the person's pointer is on the board (presence `cursor`): a mouse or pen moving
 * over the board's area, the canvas and what floats over it, sends its board position; leaving
 * the area clears it. A camera move under a still pointer sends the new board position, since
 * the pointer now points at another spot. Cleared on unmount. Main thread.
 *
 * @param connection - The board's connection; nothing without presence.
 * @param engine - The engine; nothing until it runs.
 * @param camera - The camera on screen; a camera move sends the cursor again.
 * @param anchor - An element beside the canvas, in the board's area.
 */
export function useShareCursor(
  connection: Pick<BoardConnection, 'showCursor'> | undefined,
  engine: CursorEngine | undefined,
  camera: CameraSource | undefined,
  anchor: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const show = connection?.showCursor?.bind(connection);
    const area = anchor.current?.parentElement;
    const canvas = area?.querySelector('canvas');
    if (show === undefined || engine === undefined || area == null || canvas == null) {
      return undefined;
    }
    let pointer: { readonly x: number; readonly y: number } | undefined;
    let isShown = false;
    const publish = (): void => {
      if (pointer === undefined) {
        if (isShown) show(null);
        isShown = false;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const point = cursorPointOf(engine.camera(), {
        x: pointer.x - rect.left,
        y: pointer.y - rect.top,
      });
      if (point === null && !isShown) return;
      show(point);
      isShown = point !== null;
    };
    const move = (event: PointerEvent): void => {
      if (!SHARED_POINTERS.has(event.pointerType)) return;
      pointer = { x: event.clientX, y: event.clientY };
      publish();
    };
    const leave = (event: PointerEvent): void => {
      if (!SHARED_POINTERS.has(event.pointerType)) return;
      pointer = undefined;
      publish();
    };
    area.addEventListener('pointermove', move);
    area.addEventListener('pointerleave', leave);
    const stopCamera = camera?.subscribe(publish);
    return () => {
      area.removeEventListener('pointermove', move);
      area.removeEventListener('pointerleave', leave);
      stopCamera?.();
      pointer = undefined;
      publish();
    };
  }, [connection, engine, camera, anchor]);
}

/**
 * Draws the peers' cursors on the page shown into `layer` (`PeerCursorLayer`), following their
 * presence, the page shown and the camera.
 *
 * @param props - The connection, engine, camera and frames.
 * @param layer - The layer's element.
 */
function useDrawPeerCursors(props: PeerCursorsProps, layer: RefObject<HTMLElement | null>): void {
  const { connection, engine, camera, frames = ANIMATION_FRAMES } = props;
  useEffect(() => {
    const element = layer.current;
    const remote = connection?.remotePresence?.bind(connection);
    if (element === null || connection === undefined || remote === undefined) return undefined;
    const cursors = new PeerCursorLayer(element, frames, isReducedMotion);
    const refresh = (): void => {
      const page = engine?.pages?.current() ?? DEFAULT_PAGE_ID;
      cursors.setCursors(peerCursorsOf(remote(), page, DEFAULT_PAGE_ID));
    };
    const place = (): void => {
      const shown = camera?.read();
      if (shown !== undefined) cursors.setCamera(shown);
    };
    place();
    refresh();
    const stops = [
      connection.subscribe(refresh),
      engine?.pages?.subscribe(refresh),
      camera?.subscribe(place),
    ];
    return () => {
      for (const stop of stops) stop?.();
      cursors.destroy();
    };
  }, [connection, engine, camera, frames, layer]);
}

/**
 * The collaborators' live cursors (item 10; presence shows live cursors with names): each
 * peer's pointer on the page shown, as an arrow in their presence colour with their name, following
 * the camera; and the person's own pointer shared with them (`useShareCursor`), whatever their
 * role. Each cursor carries `data-peer-cursor` (the peer's awareness client id),
 * `data-principal-id` and `data-presence-color`. Page.
 *
 * @param props - The connection, engine and camera.
 * @returns The layer, empty without peers' cursors.
 */
export function PeerCursors(props: PeerCursorsProps): ReactElement {
  const layer = useRef<HTMLDivElement>(null);
  useShareCursor(props.connection, props.engine, props.camera, layer);
  useDrawPeerCursors(props, layer);
  return <div ref={layer} className={styles.layer} data-peer-cursors="" aria-hidden="true" />;
}

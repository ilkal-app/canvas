import { useEffect } from 'react';

import type { PresenceViewport } from '@canvas/collab';
import type { Camera } from '@canvas/engine';

import type { BoardConnection } from '../collab/board-connection.js';
import type { CameraSource } from '../editing/camera-source.js';

/**
 * The region a camera shows, as presence carries it: its top-left corner and size in world units,
 * and the zoom. Pure.
 *
 * @param camera - The camera.
 * @returns The viewport, or null for a camera with no screen yet.
 */
export function presenceViewportOf(camera: Camera): PresenceViewport | null {
  if (camera.viewportWidthPx <= 0 || camera.viewportHeightPx <= 0 || camera.zoom <= 0) return null;
  return {
    x: camera.x,
    y: camera.y,
    w: camera.viewportWidthPx / camera.zoom,
    h: camera.viewportHeightPx / camera.zoom,
    zoom: camera.zoom,
  };
}

/**
 * Tells collaborators which part of the board this person's screen shows (their
 * minimaps draw it), as the camera moves, and that it shows none once unmounted. Presence sends
 * at most a few times a second, so every camera change may set it. Main thread.
 *
 * @param connection - The board's connection; nothing without one or without presence.
 * @param camera - The camera; nothing without one.
 */
export function usePublishViewport(
  connection: Pick<BoardConnection, 'showViewport'> | undefined,
  camera: CameraSource | undefined,
): void {
  useEffect(() => {
    const show = connection?.showViewport?.bind(connection);
    if (show === undefined || camera === undefined) return undefined;
    const publish = (): void => {
      const shown = camera.read();
      if (shown !== undefined) show(presenceViewportOf(shown));
    };
    publish();
    const stop = camera.subscribe(publish);
    return () => {
      stop();
      show(null);
    };
  }, [connection, camera]);
}

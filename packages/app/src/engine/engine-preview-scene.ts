import { yieldToBrowser } from '@canvas/collab';
import { isSameCamera, visibleWorldBounds, type Camera, type EngineHost } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import type { EngineDocument } from './engine-document.js';
import type { HostView } from './host-view.js';

/** The inert scene replaced when the live document takes over the same host. */
export interface EnginePreviewScene {
  /** Camera already drawn; kept fixed during the handoff. */
  readonly camera: Camera;
  /** Grid state already drawn, retained through the live replacement frame. */
  readonly isGridVisible: boolean;
  /** All objects sent to the preview, including ancestors. */
  readonly objectIds: readonly ObjectId[];
}

/**
 * Uses an ordered runtime read to acknowledge a frame after queued scene changes. A generic
 * onFrame notification can already be in flight from the worker before those changes arrive.
 *
 * @param host - Host receiving the replacement scene before this call.
 * @param camera - Camera the replacement must draw; a getter follows resizes during the read.
 * @returns After the ordered read confirms the replacement frame.
 * @throws {Error} When the host cannot confirm that frame.
 */
export async function waitForSceneFrame(
  host: EngineHost,
  camera: Camera | (() => Camera),
): Promise<void> {
  const current = typeof camera === 'function' ? camera : () => camera;
  let busyFrames = 0;
  for (;;) {
    const requested = current();
    const frame = await host.readProjection?.(visibleWorldBounds(requested));
    if (!isSameCamera(requested, current())) continue;
    // Busy/reentrant frames deliberately return no projection. Ask for a fresh ordered
    // frame without accepting absence as readiness; permanent inability remains bounded.
    if (frame === undefined && host.readProjection !== undefined && ++busyFrames < 32) continue;
    if (frame === undefined || !isSameCamera(frame.camera, requested)) {
      throw new Error('The live scene frame could not be confirmed.');
    }
    return;
  }
}

/**
 * Attaches the live document to a host's view: the objects the camera shows first,
 * then the rest of a large board in slices, each sent at once, yielding to the browser between
 * them so input is handled meanwhile.
 *
 * @param document - The live document.
 * @param view - The host's view.
 * @param camera - The camera the first frame draws.
 * @param preview - The inert scene already drawn, if any.
 */
export function attachLiveScene(
  document: Pick<EngineDocument, 'attach'>,
  view: HostView,
  camera: Camera,
  preview: EnginePreviewScene | undefined,
): void {
  void document.attach(view, preview?.objectIds, {
    viewport: visibleWorldBounds(camera),
    yieldToBrowser,
    afterSlice: () => {
      view.flush();
    },
  });
}

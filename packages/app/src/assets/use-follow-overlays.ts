import { useEffect, useState } from 'react';

import type { ObjectId } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';

import { imageOverlayRectOf } from './image-overlay-placement.js';
import type { ImageUploads, UploadEntry } from './image-uploads.js';

/**
 * Where every overlay goes now, as one string: the same while neither the camera nor an image
 * moved.
 *
 * @param overlays - The overlays' images.
 * @param engine - The engine.
 * @returns The key.
 */
function placementsKey(
  overlays: readonly { readonly id: ObjectId }[],
  engine: MountedEngine,
): string {
  const camera = engine.camera();
  return overlays
    .map(({ id }) => {
      const rect = imageOverlayRectOf(engine.board.board, id, camera);
      return rect === undefined
        ? '-'
        : [rect.left, rect.top, rect.width, rect.height, rect.rotationDeg]
            .map((value) => value.toFixed(2))
            .join(',');
    })
    .join(';');
}

/**
 * Follows the camera and the images while overlays show (`UploadBadges`): checks every animation
 * frame where they go, and re-renders only when that changed (React bails out of an equal
 * state); with no overlay, no frame is asked for, so a board at rest costs nothing. A failed
 * upload whose images are all gone (deleted another way than Remove) is forgotten, so its bytes
 * go.
 *
 * @param overlays - The overlays' images.
 * @param entries - The uploads.
 * @param engine - The engine, once it runs.
 * @param uploads - The uploads, to forget one.
 */
export function useFollowOverlays(
  overlays: readonly { readonly id: ObjectId }[],
  entries: readonly UploadEntry[],
  engine: MountedEngine | undefined,
  uploads: ImageUploads,
): void {
  const [, setKey] = useState('');
  useEffect(() => {
    if (engine === undefined || overlays.length === 0) return undefined;
    let frame = requestAnimationFrame(function tick() {
      setKey(placementsKey(overlays, engine));
      for (const entry of entries) {
        const isGone = entry.objectIds.every((id) => engine.board.board.get(id) === undefined);
        if (entry.state.phase === 'failed' && isGone) uploads.forget(entry.assetId);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [overlays, entries, engine, uploads]);
}

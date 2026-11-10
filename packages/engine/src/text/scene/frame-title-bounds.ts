import type { WorldBounds } from '../../camera/camera.js';
import { FRAME_TITLE_HIDDEN_WIDTH_PX } from '../../lod/lod-thresholds.js';

import { localQuadBounds, placedBounds } from './drawn-text-bounds.js';
import type { TextObjectEntry } from './text-object-entry.js';

/**
 * Where a frame's name can draw on the board at any zoom, for the spatial index:
 * the name is laid out in CSS pixels and scaled by the camera's CSS pixel (1 / zoom), so it
 * grows on the board as the camera zooms out, until the frame is under
 * `FRAME_TITLE_HIDDEN_WIDTH_PX` device px wide on screen and the name is hidden. While it is
 * drawn, `width × zoom × dpr ≥ 40`, so one CSS pixel is at most `width × dpr / 40` world units;
 * every size the name takes is its laid-out rectangle scaled about the frame's corner by at most
 * that, so the hull of the corner and the rectangle at that scale holds them all, turned with
 * the frame. The bounds depend on the frame, its name and the device pixel ratio only, never on
 * the zoom, so a zoom or pan re-indexes nothing; a new device pixel ratio publishes them again.
 * Pure.
 *
 * @param entry - The frame's entry: its target and its name's quads, CSS px.
 * @param dpr - The device pixel ratio.
 * @returns The bounds, or `undefined` for an entry that is not a frame's or draws nothing yet.
 */
export function frameTitleBounds(entry: TextObjectEntry, dpr: number): WorldBounds | undefined {
  const { object } = entry.target;
  const local = localQuadBounds(entry);
  if (object.type !== 'frame' || local === undefined) return undefined;
  const reach = (object.width * dpr) / FRAME_TITLE_HIDDEN_WIDTH_PX;
  return placedBounds(entry, {
    minX: Math.min(0, local.minX * reach),
    minY: Math.min(0, local.minY * reach),
    maxX: Math.max(0, local.maxX * reach),
    maxY: Math.max(0, local.maxY * reach),
  });
}

import { anchorsOfBox } from '../line/line-anchors.js';
import { anchorMarkerRect, endpointHandleRects } from '../line/line-overlay.js';
import { outlineOf } from '../select/overlay-marks.js';
import type { OverlayPalette } from '../select/overlay-palette.js';
import { OUTLINE_WIDTH_PX, type OverlayRect } from '../select/overlay-rects.js';
import { orientedBoxOf, type SelectionSource } from '../select/selection-geometry.js';

import type { ConnectorToolEnd } from './connector-end.js';

/**
 * What a connector end shows while it is placed: on an object, a handle on each of the
 * object's anchors, so the person sees where it can attach, and a marker on the anchor the end
 * landed on; nothing for a free end, or an object with no box any longer. Pure.
 *
 * @param end - The end.
 * @param source - The document.
 * @param zoom - The camera zoom, which sizes the handles on screen.
 * @returns The rectangles.
 */
export function connectorEndRects(
  end: ConnectorToolEnd,
  source: SelectionSource,
  zoom: number,
): OverlayRect[] {
  if (end.kind === 'point') return [];
  const box = orientedBoxOf(end.objectId, source);
  const handles = box
    ? anchorsOfBox(box).flatMap((anchor) => endpointHandleRects(anchor, zoom))
    : [];
  return end.anchor ? [...handles, anchorMarkerRect(end.point, zoom)] : handles;
}

/**
 * The object a connector's end would attach to on release (the design's target
 * highlight): its box outlined one pixel outside in the palette's `you`, under the anchors; nothing
 * without a palette (the anchors alone, as before) or for an object with no box. Pure.
 *
 * @param end - The end, on an object.
 * @param source - The document.
 * @param zoom - The camera zoom, which keeps the outline one screen pixel.
 * @param palette - The shell's palette, if any.
 * @returns The outline's strips.
 */
export function connectorTargetRects(
  end: Extract<ConnectorToolEnd, { readonly kind: 'object' }>,
  source: SelectionSource,
  zoom: number,
  palette: OverlayPalette | undefined,
): OverlayRect[] {
  const box = palette && orientedBoxOf(end.objectId, source);
  return box ? outlineOf(box, OUTLINE_WIDTH_PX / zoom, palette.you) : [];
}

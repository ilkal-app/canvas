import type { Rgba } from '@canvas/schema';

import {
  isPeerBox,
  outlineRectsOf,
  peerOutlineWidth,
  type PeerEditingBox,
  type PeerEditingRect,
} from './peer-editing-model.js';

/**
 * One outline of a peer's selection (item 14, as Figma shows a collaborator's): a
 * selected object's turned box, outlined just outside its edge in the peer's presence colour.
 */
export interface PeerSelectionOutline {
  /** The selected object's box, world units, turned about its top-left corner. */
  readonly box: PeerEditingBox;
  /** The peer's presence colour, straight alpha, channels 0 to 1. */
  readonly color: Rgba;
}

/** What the peer selection layer shows: every peer's selected objects' outlines. */
export interface PeerSelectionModel {
  /** The outlines, in drawing order; none draws nothing. */
  readonly outlines: readonly PeerSelectionOutline[];
}

/** No peer selection: the layer draws nothing and uploads nothing. */
export const EMPTY_PEER_SELECTION: PeerSelectionModel = Object.freeze({
  outlines: Object.freeze([]),
});

/**
 * The most outlines the layer draws, whatever the model holds: four rectangles each. The page
 * bounds what it sends per peer (a large selection is outlined once, round all of it), so this
 * only guards the layer against a model built some other way.
 */
export const MAX_PEER_SELECTION_OUTLINES = 4096;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isOutline(value: unknown): value is PeerSelectionOutline {
  if (!isRecord(value)) return false;
  const { color } = value;
  return (
    isPeerBox(value.box) &&
    Array.isArray(color) &&
    color.length === 4 &&
    color.every((channel) => typeof channel === 'number' && Number.isFinite(channel))
  );
}

/**
 * Checks a peer selection model that crossed a thread: a list of outlines, each a finite box of
 * non-negative size and a four-channel colour. Pure.
 *
 * @param value - The received model.
 * @returns Whether it is a well-formed {@link PeerSelectionModel}.
 */
export function isPeerSelectionModel(value: unknown): value is PeerSelectionModel {
  return isRecord(value) && Array.isArray(value.outlines) && value.outlines.every(isOutline);
}

/**
 * The rectangles that draw a model at a zoom: per outline, four bands `PEER_OUTLINE_PX` wide (in
 * whole device pixels, at least one) just outside the box, as a peer editing a text is outlined.
 * At most {@link MAX_PEER_SELECTION_OUTLINES} outlines. The widths are screen sizes, so a pan keeps
 * the rectangles and only a zoom or a pixel ratio change rebuilds them. Pure.
 *
 * @param model - The outlines.
 * @param zoom - The camera zoom, screen px per world unit; positive.
 * @param dpr - Device pixels per CSS pixel; 1 if absent.
 * @returns The rectangles, in drawing order.
 */
export function peerSelectionRectsOf(
  model: PeerSelectionModel,
  zoom: number,
  dpr = 1,
): PeerEditingRect[] {
  const line = peerOutlineWidth(zoom, dpr);
  return model.outlines
    .slice(0, MAX_PEER_SELECTION_OUTLINES)
    .flatMap(({ box, color }) => outlineRectsOf(box, line, color));
}

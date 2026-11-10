import type { Rgba } from '@canvas/schema';

/**
 * A rectangle turned about its top-left corner, in world units: where a peer's edited text box,
 * caret or selection span lies. A local point (u, v) of the box maps to the world as
 * (`x` + u·cos − v·sin, `y` + u·sin + v·cos), with `rotation` clockwise on screen (y down).
 */
export interface PeerEditingBox {
  /** World x of the top-left corner, world units. */
  readonly x: number;
  /** World y of the top-left corner, world units. */
  readonly y: number;
  /** Width along the box's own x axis, world units, at least 0. */
  readonly width: number;
  /** Height along the box's own y axis, world units, at least 0. */
  readonly height: number;
  /** Turn about the top-left corner, radians, clockwise on screen. */
  readonly rotation: number;
}

/**
 * One peer editing a text (Figma "States" E1, node 36:1836) as the layer draws it:
 * the text box outlined in the peer's presence colour, the selection highlighted in it, and
 * the caret. The page works out the geometry from the peer's presence and the text's layout;
 * the engine only draws.
 */
export interface PeerEditingMark {
  /** The edited text box, outlined just outside its edge. */
  readonly box: PeerEditingBox;
  /** The peer's presence colour, straight alpha, channels 0 to 1. */
  readonly color: Rgba;
  /** The caret's line box (its width is ignored: the caret has a screen width). */
  readonly caret: PeerEditingBox;
  /** The selection's span on each line it covers; none for a collapsed caret. */
  readonly highlights: readonly PeerEditingBox[];
}

/** What the peer editing layer shows: every peer editing a text, in drawing order. */
export interface PeerEditingModel {
  /** The peers; none draws nothing. */
  readonly peers: readonly PeerEditingMark[];
}

/** No peer editing: the layer draws nothing and uploads nothing. */
export const EMPTY_PEER_EDITING: PeerEditingModel = Object.freeze({ peers: Object.freeze([]) });

/** How thick a peer's outline is on screen, CSS px (the design's 1.5 px), in whole device px. */
export const PEER_OUTLINE_PX = 1.5;

/** How wide a peer's caret is on screen, CSS px: a little wider than the local 1.5 px one. */
export const PEER_CARET_PX = 2;

/** How opaque a peer's selection highlight is, over the text it covers. */
export const PEER_HIGHLIGHT_ALPHA = 0.25;

/** One flat rectangle of the layer, turned about its origin, in world units. */
export interface PeerEditingRect {
  /** World x of the origin, the rectangle's top-left corner. */
  readonly x: number;
  /** World y of the origin. */
  readonly y: number;
  /** Width along the turned x axis, world units. */
  readonly width: number;
  /** Height along the turned y axis, world units. */
  readonly height: number;
  /** Cosine of the turn. */
  readonly cos: number;
  /** Sine of the turn. */
  readonly sin: number;
  /** Straight-alpha colour. */
  readonly color: Rgba;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether a value that crossed a thread is a box: finite, of non-negative size. Pure.
 *
 * @param value - The value.
 * @returns Whether it is a {@link PeerEditingBox}.
 */
export function isPeerBox(value: unknown): value is PeerEditingBox {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    isFiniteNumber(value.rotation) &&
    value.width >= 0 &&
    value.height >= 0
  );
}

function isMark(value: unknown): value is PeerEditingMark {
  if (!isRecord(value)) return false;
  const { color, highlights } = value;
  return (
    isPeerBox(value.box) &&
    isPeerBox(value.caret) &&
    Array.isArray(highlights) &&
    highlights.every(isPeerBox) &&
    Array.isArray(color) &&
    color.length === 4 &&
    color.every(isFiniteNumber)
  );
}

/**
 * Checks a peer editing model that crossed a thread: a list of peers, each with a finite box,
 * caret and highlights of non-negative size and a four-channel colour. Pure.
 *
 * @param value - The received model.
 * @returns Whether it is a well-formed {@link PeerEditingModel}.
 */
export function isPeerEditingModel(value: unknown): value is PeerEditingModel {
  return isRecord(value) && Array.isArray(value.peers) && value.peers.every(isMark);
}

/**
 * A rectangle in a box's own frame, placed in the world turned with the box.
 *
 * @param box - The box whose frame it is in.
 * @param local - The rectangle, world units from the box's corner along its axes.
 * @param local.x - Its left, along the box's x axis.
 * @param local.y - Its top, along the box's y axis.
 * @param local.width - Its width.
 * @param local.height - Its height.
 * @param color - Its colour.
 * @returns The world rectangle.
 */
function placed(
  box: PeerEditingBox,
  local: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  color: Rgba,
): PeerEditingRect {
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  return {
    x: box.x + local.x * cos - local.y * sin,
    y: box.y + local.x * sin + local.y * cos,
    width: local.width,
    height: local.height,
    cos,
    sin,
    color,
  };
}

/**
 * The four bands, `line` world units thick, that outline a box just outside its edge, turned
 * with it: top and bottom across the corners, left and right between them. Pure.
 *
 * @param box - The box.
 * @param line - The band's thickness, world units.
 * @param color - The colour.
 * @returns The bands.
 */
export function outlineRectsOf(box: PeerEditingBox, line: number, color: Rgba): PeerEditingRect[] {
  const { width, height } = box;
  return [
    placed(box, { x: -line, y: -line, width: width + 2 * line, height: line }, color),
    placed(box, { x: -line, y: height, width: width + 2 * line, height: line }, color),
    placed(box, { x: -line, y: 0, width: line, height }, color),
    placed(box, { x: width, y: 0, width: line, height }, color),
  ];
}

/**
 * How thick a peer's outline is at a zoom and pixel ratio: {@link PEER_OUTLINE_PX} in whole
 * device pixels, at least one, in world units. Pure.
 *
 * @param zoom - The camera zoom, screen px per world unit; positive.
 * @param dpr - Device pixels per CSS pixel.
 * @returns The thickness, world units.
 */
export function peerOutlineWidth(zoom: number, dpr: number): number {
  return (Math.max(1, Math.round(PEER_OUTLINE_PX * dpr)) / dpr) * (1 / zoom);
}

/**
 * The rectangles that draw a model at a zoom, peer by peer: the selection's spans in the peer's
 * colour at {@link PEER_HIGHLIGHT_ALPHA}, the outline as four bands {@link PEER_OUTLINE_PX} wide
 * (whole device pixels, at least one) just outside the box, and the caret
 * {@link PEER_CARET_PX} wide, centred on its line box's left edge. The widths are screen sizes,
 * so they are divided by the zoom; nothing else depends on the camera, so a pan keeps the
 * rectangles. Pure.
 *
 * @param model - The peers.
 * @param zoom - The camera zoom, screen px per world unit; positive.
 * @param dpr - Device pixels per CSS pixel; 1 if absent.
 * @returns The rectangles, in drawing order.
 */
export function peerEditingRectsOf(
  model: PeerEditingModel,
  zoom: number,
  dpr = 1,
): PeerEditingRect[] {
  const line = peerOutlineWidth(zoom, dpr);
  const caretWidth = PEER_CARET_PX * (1 / zoom);
  return model.peers.flatMap(({ box, caret, highlights, color }) => {
    const fill: Rgba = [color[0], color[1], color[2], color[3] * PEER_HIGHLIGHT_ALPHA];
    return [
      ...highlights.map((span) =>
        placed(span, { x: 0, y: 0, width: span.width, height: span.height }, fill),
      ),
      ...outlineRectsOf(box, line, color),
      placed(caret, { x: -caretWidth / 2, y: 0, width: caretWidth, height: caret.height }, color),
    ];
  });
}

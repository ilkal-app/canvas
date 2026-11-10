import type { Point } from '@canvas/schema';

import type { ResizeHandle } from './handle-layout.js';
import { boxPointToWorld, worldPointToBox, type OrientedBox } from './oriented-box.js';

/**
 * The narrowest a resize leaves a frame, world units: a dragged edge stops this far from the
 * opposite one instead of crossing it (objects have no scale to mirror them with).
 */
export const MIN_RESIZE_SIZE = 1;

/** The frame's edges in its own coordinates while a handle drags them. */
interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const MOVES_LEFT: ReadonlySet<ResizeHandle> = new Set(['nw', 'w', 'sw']);
const MOVES_RIGHT: ReadonlySet<ResizeHandle> = new Set(['ne', 'e', 'se']);
const MOVES_TOP: ReadonlySet<ResizeHandle> = new Set(['nw', 'n', 'ne']);
const MOVES_BOTTOM: ReadonlySet<ResizeHandle> = new Set(['sw', 's', 'se']);

/**
 * Drags the edges a handle holds by a displacement in the frame's own coordinates, stopping
 * each short of the opposite edge.
 *
 * @param frame - The frame before the drag.
 * @param handle - The handle.
 * @param delta - The displacement along the frame's axes, world units.
 * @returns The dragged edges.
 */
function dragEdges(frame: OrientedBox, handle: ResizeHandle, delta: Point): Edges {
  const minWidth = Math.min(MIN_RESIZE_SIZE, frame.width);
  const minHeight = Math.min(MIN_RESIZE_SIZE, frame.height);
  const edges: Edges = { left: 0, top: 0, right: frame.width, bottom: frame.height };
  if (MOVES_LEFT.has(handle)) edges.left = Math.min(delta.x, frame.width - minWidth);
  if (MOVES_RIGHT.has(handle)) edges.right = Math.max(frame.width + delta.x, minWidth);
  if (MOVES_TOP.has(handle)) edges.top = Math.min(delta.y, frame.height - minHeight);
  if (MOVES_BOTTOM.has(handle)) edges.bottom = Math.max(frame.height + delta.y, minHeight);
  return edges;
}

/**
 * The size dragged edges take to keep an aspect ratio. With no aspect given, the frame's own:
 * from a corner both sides take the larger of the two ratios, from an edge the other side
 * follows the dragged one's ratio, and a side of zero length has no ratio (a zero-width frame
 * dragged by a corner keeps its shape free). With an aspect (a lone image's drawn aspect,
 * `ResizeAspect`), the size is of that aspect: from a corner the larger box the dragged edges
 * reach, from an edge the dragged side's length with the other side to match.
 *
 * @param frame - The frame before the drag.
 * @param handle - The handle.
 * @param edges - The dragged edges.
 * @param aspect - The aspect to keep, width over height; the frame's own if undefined.
 * @returns The width and height, or undefined to leave the edges free.
 */
function proportionalSize(
  frame: OrientedBox,
  handle: ResizeHandle,
  edges: Edges,
  aspect: number | undefined,
): { readonly width: number; readonly height: number } | undefined {
  const isHorizontal = MOVES_LEFT.has(handle) || MOVES_RIGHT.has(handle);
  const isVertical = MOVES_TOP.has(handle) || MOVES_BOTTOM.has(handle);
  const draggedWidth = edges.right - edges.left;
  const draggedHeight = edges.bottom - edges.top;
  if (aspect !== undefined) {
    const width = !isVertical
      ? draggedWidth
      : !isHorizontal
        ? draggedHeight * aspect
        : Math.max(draggedWidth, draggedHeight * aspect);
    return { width, height: width / aspect };
  }
  const { width, height } = frame;
  const ratios: number[] = [];
  if (isHorizontal && width > 0) ratios.push(draggedWidth / width);
  if (isVertical && height > 0) ratios.push(draggedHeight / height);
  if (ratios.length === 0) return undefined;
  const scale = Math.max(...ratios);
  return { width: width * scale, height: height * scale };
}

/**
 * Makes dragged edges keep an aspect ratio (`proportionalSize`): the opposite corner stays when
 * a corner is dragged; an edge's other side grows about the frame's centre line across it.
 *
 * @param frame - The frame before the drag.
 * @param handle - The handle.
 * @param edges - The dragged edges; changed in place.
 * @param aspect - The aspect to keep; the frame's own if undefined.
 */
function keepAspectRatio(
  frame: OrientedBox,
  handle: ResizeHandle,
  edges: Edges,
  aspect: number | undefined,
): void {
  const size = proportionalSize(frame, handle, edges, aspect);
  if (size === undefined) return;
  const { width, height } = frame;
  const { width: newWidth, height: newHeight } = size;
  const isHorizontal = MOVES_LEFT.has(handle) || MOVES_RIGHT.has(handle);
  const isVertical = MOVES_TOP.has(handle) || MOVES_BOTTOM.has(handle);
  if (isHorizontal && MOVES_LEFT.has(handle)) edges.left = edges.right - newWidth;
  else if (isHorizontal) edges.right = edges.left + newWidth;
  else [edges.left, edges.right] = [(width - newWidth) / 2, (width + newWidth) / 2];
  if (isVertical && MOVES_TOP.has(handle)) edges.top = edges.bottom - newHeight;
  else if (isVertical) edges.bottom = edges.top + newHeight;
  else [edges.top, edges.bottom] = [(height - newHeight) / 2, (height + newHeight) / 2];
}

/**
 * Where a resize handle drag takes the selection frame: the handle's edges follow the pointer's
 * displacement, measured along the frame's own axes so a turned frame resizes the way it looks,
 * while the other edges stay; a proportional resize (Shift, or a plain drag of an image:
 * `ResizeAspect`) keeps the frame's aspect ratio, or the aspect given (a lone image's drawn
 * aspect). The frame keeps its rotation. Pure.
 *
 * @param frame - The frame when the drag began, world units.
 * @param handle - The handle dragged.
 * @param delta - The pointer's displacement since the press, world units.
 * @param isProportional - Whether the resize keeps an aspect ratio.
 * @param aspect - The aspect to keep, width over height in the frame's axes; the frame's own if
 *   undefined.
 * @returns The resized frame.
 */
export function resizeFrame(
  frame: OrientedBox,
  handle: ResizeHandle,
  delta: Point,
  isProportional: boolean,
  aspect?: number,
): OrientedBox {
  const along = worldPointToBox({ ...frame, x: 0, y: 0 }, delta);
  const edges = dragEdges(frame, handle, along);
  if (isProportional) keepAspectRatio(frame, handle, edges, aspect);
  const corner = boxPointToWorld(frame, { x: edges.left, y: edges.top });
  return {
    x: corner.x,
    y: corner.y,
    width: edges.right - edges.left,
    height: edges.bottom - edges.top,
    rotation: frame.rotation,
  };
}

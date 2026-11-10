import type { Point, Rgba } from '@canvas/schema';

import { HANDLE_SIZE_PX, handleLayout, type ResizeAbility } from './handle-layout.js';
import { boxPointToWorld, type OrientedBox } from './oriented-box.js';
import { inBox, outlineOf, type OverlayRect } from './overlay-marks.js';
import type { SelectionStyle } from './overlay-palette.js';

/**
 * Under the whiteboard design's selection (`OverlayPalette.selection`), the board left
 * between the selection and its frame's outline, CSS px.
 */
export const SELECTION_FRAME_GAP_PX = 2;

/** Under the whiteboard design's selection, the width of the frame's outline, CSS px. */
export const SELECTION_FRAME_WIDTH_PX = 2;

/**
 * Under the whiteboard design's selection, the width of a handle's edge, CSS px: 3 device px on a
 * 2x display; on a 1x display its inner edge falls on a pixel centre, and either neighbour is
 * an acceptable rendering.
 */
export const HANDLE_EDGE_PX = 1.5;

/** A handle's two colours: its edge and its inside. */
export interface HandleColors {
  /** The edge. */
  readonly edge: Rgba;
  /** The inside. */
  readonly fill: Rgba;
}

/**
 * A handle: a square in its edge colour with an inside in its fill colour, turned with the frame.
 *
 * @param frame - The frame.
 * @param centre - The handle's centre, world units.
 * @param size - Its side, world units.
 * @param t - Its border width, world units.
 * @param colors - Its colours.
 * @returns The two squares.
 */
export function handleOf(
  frame: OrientedBox,
  centre: Point,
  size: number,
  t: number,
  colors: HandleColors,
): OverlayRect[] {
  const at = (inset: number): OrientedBox => {
    const side = size - 2 * inset;
    const offset = boxPointToWorld({ ...frame, x: 0, y: 0 }, { x: -side / 2, y: -side / 2 });
    return {
      x: centre.x + offset.x,
      y: centre.y + offset.y,
      width: side,
      height: side,
      rotation: frame.rotation,
    };
  };
  return [
    { box: at(0), color: colors.edge },
    { box: at(t), color: colors.fill },
  ];
}

/**
 * Where the whiteboard design draws a frame's outline and handles: the frame grown by
 * a number of CSS px on every side, turned with it.
 *
 * @param frame - The selection frame.
 * @param px - World units per CSS px.
 * @param by - How far to grow it, CSS px.
 * @returns The grown frame.
 */
function grownFrame(frame: OrientedBox, px: number, by: number): OrientedBox {
  const reach = by * px;
  return inBox(frame, -reach, -reach, frame.width + 2 * reach, frame.height + 2 * reach);
}

/**
 * The frame's outline in the whiteboard design: {@link SELECTION_FRAME_WIDTH_PX} wide,
 * {@link SELECTION_FRAME_GAP_PX} outside the frame, in the style's colour; screen sizes.
 *
 * @param frame - The selection frame.
 * @param zoom - The camera zoom, CSS px per world unit.
 * @param style - The style.
 * @returns The outline's four strips.
 */
export function styledOutlineOf(
  frame: OrientedBox,
  zoom: number,
  style: SelectionStyle,
): OverlayRect[] {
  const px = 1 / zoom;
  const box = grownFrame(frame, px, SELECTION_FRAME_GAP_PX);
  return outlineOf(box, SELECTION_FRAME_WIDTH_PX * px, style.frameColor);
}

/**
 * The frame's handles in the whiteboard design: centred on the outline's middle line
 * (`styledOutlineOf`), so a corner handle sits three CSS px out of its corner along both of the
 * frame's axes and an edge handle three px out of its edge; each {@link HANDLE_SIZE_PX} square,
 * edged {@link HANDLE_EDGE_PX} in the style's colour round its `handleFill`; screen sizes.
 *
 * @param frame - The selection frame.
 * @param zoom - The camera zoom, CSS px per world unit.
 * @param canResize - Which handles the selection offers.
 * @param style - The style.
 * @returns Each handle's two squares, in `handleLayout`'s order.
 */
export function styledHandlesOf(
  frame: OrientedBox,
  zoom: number,
  canResize: ResizeAbility,
  style: SelectionStyle,
): OverlayRect[] {
  const px = 1 / zoom;
  const middle = grownFrame(frame, px, SELECTION_FRAME_GAP_PX + SELECTION_FRAME_WIDTH_PX / 2);
  const colors = { edge: style.frameColor, fill: style.handleFill };
  return handleLayout(middle, zoom, canResize).flatMap(({ centre, size }) =>
    handleOf(frame, centre, size, HANDLE_EDGE_PX * px, colors),
  );
}

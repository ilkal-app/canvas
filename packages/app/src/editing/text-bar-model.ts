import type { BoardReader } from '@canvas/document';
import {
  worldBoundsOf,
  worldToScreen,
  worldTransformOf,
  type Camera,
  type WorldBounds,
} from '@canvas/engine';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, type ObjectId } from '@canvas/schema';
import type { TextStylePatch } from '@canvas/tools';
import { isBoldWeight } from '@canvas/tools';

/** The sizes the text bar offers, world px, before the edited text's own is added. */
export const TEXT_BAR_SIZES: readonly number[] = Object.freeze([
  10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 96,
]);

/** The space between the text bar and the edited object's edge, CSS px. */
export const TEXT_BAR_GAP_PX = 12;

/** The text bar's height, CSS px (37), which decides whether it fits above. */
export const TEXT_BAR_HEIGHT_PX = 37;

/**
 * The sizes the bar's size control lists: {@link TEXT_BAR_SIZES} and, when the edited text has a
 * size of its own not among them, that one too, in order, within the schema's range. Pure.
 *
 * @param current - The edited text's size, or undefined when mixed.
 * @returns The sizes, ascending.
 */
export function textBarSizesOf(current: number | undefined): readonly number[] {
  const sizes = new Set(TEXT_BAR_SIZES);
  if (current !== undefined) sizes.add(current);
  return [...sizes]
    .filter((size) => size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE)
    .sort((first, second) => first - second);
}

/** Whether a bar toggle shows pressed: on, off, or mixed across the targeted text. */
export type ToggleState = boolean | 'mixed';

/**
 * Whether the bold and italic toggles show pressed for the edited text's style: bold at weight
 * 700, as the style panel and mod+b set it; mixed where the style leaves the field out. Pure.
 *
 * @param style - The shared fields of the targeted text.
 * @returns The toggles' states.
 */
export function emphasisOf(style: TextStylePatch): {
  readonly bold: ToggleState;
  readonly italic: ToggleState;
  readonly isUnderlined: boolean;
  readonly isStruckThrough: boolean;
} {
  return {
    bold: style.weight === undefined ? 'mixed' : isBoldWeight(style.weight),
    italic: style.italic ?? 'mixed',
    // Pressed when every targeted character has it; none and mixed both show unpressed.
    isUnderlined: style.underline === true,
    isStruckThrough: style.strikethrough === true,
  };
}

/** The least room the text bar keeps from the canvas's left and right edges, CSS px. */
export const TEXT_BAR_MARGIN_PX = 8;

/** The space between the text bar and its "Esc to finish" hint, CSS px. */
export const TEXT_BAR_HINT_GAP_PX = 10;

/**
 * How wide the text bar and its hint are on screen, and how much of the canvas's left and right
 * sides the open drawers cover (the layers drawer, on the left; the inspector's
 * column, on the right), as the page measured them.
 */
export interface TextBarSize {
  /** The bar's width, CSS px. */
  readonly barWidthPx: number;
  /** The hint's width, CSS px. */
  readonly hintWidthPx: number;
  /** How far an open drawer reaches into the canvas from its left edge, CSS px; 0 if none. */
  readonly leftClearancePx: number;
  /** How far an open drawer reaches into the canvas from its right edge, CSS px; 0 if none. */
  readonly rightClearancePx: number;
}

/** Nothing measured yet: the bar is placed by its anchor alone until it is. */
export const UNMEASURED_TEXT_BAR: TextBarSize = Object.freeze({
  barWidthPx: 0,
  hintWidthPx: 0,
  leftClearancePx: 0,
  rightClearancePx: 0,
});

/** A box on the page, viewport CSS px. */
export type PageBox = Pick<DOMRectReadOnly, 'left' | 'right'>;

/**
 * How far the open drawers reach into the canvas from its sides: the layers drawer's right edge
 * past the canvas's left, the inspector column's left edge short of its right. A drawer that is
 * closed (no box) or outside the canvas covers nothing. Pure.
 *
 * @param canvas - The canvas's box.
 * @param layers - The open layers drawer's box, if any.
 * @param inspector - The open inspector drawer's box, if any.
 * @returns The left and right clearances, CSS px, each at most the canvas's width.
 */
export function drawerClearanceOf(
  canvas: PageBox,
  layers: PageBox | undefined,
  inspector: PageBox | undefined,
): Pick<TextBarSize, 'leftClearancePx' | 'rightClearancePx'> {
  const width = Math.max(0, canvas.right - canvas.left);
  const clamp = (value: number) => Math.min(width, Math.max(0, value));
  return {
    leftClearancePx: layers === undefined ? 0 : clamp(layers.right - canvas.left),
    rightClearancePx: inspector === undefined ? 0 : clamp(canvas.right - inspector.left),
  };
}

/** Where the text bar goes on the canvas. */
export interface TextBarPlacement {
  /** The bar's left edge, CSS px from the canvas's left edge; the hint follows it. */
  readonly left: number;
  /**
   * Above: the bar's bottom edge; below: its top edge; CSS px from the canvas's top edge.
   */
  readonly y: number;
  /** Whether it sits above the object (where it fits) or below it. */
  readonly side: 'above' | 'below';
}

/**
 * Where the text bar goes for an edited object: centred over it, its bottom
 * {@link TEXT_BAR_GAP_PX} above the object's top edge; below the object instead when there is no
 * room above it on the canvas. The bar and its hint together are kept on the board the person
 * can reach: the canvas less the open drawers over its sides, at least
 * {@link TEXT_BAR_MARGIN_PX} inside it (the left edge wins where it is too narrow for both), so
 * every control can be pressed for an object at the board's edge or under a drawer. Pure.
 *
 * @param bounds - The edited object's world bounds.
 * @param camera - The camera on screen; its viewport is the canvas, CSS px.
 * @param size - The bar's and the hint's widths and the drawers' clearances; unmeasured, the bar's
 *   left edge is the centre.
 * @returns The placement.
 */
export function textBarPlacementOf(
  bounds: WorldBounds,
  camera: Camera,
  size: TextBarSize = UNMEASURED_TEXT_BAR,
): TextBarPlacement {
  const topLeft = worldToScreen(camera, { x: bounds.minX, y: bounds.minY });
  const bottomRight = worldToScreen(camera, { x: bounds.maxX, y: bounds.maxY });
  const centreX = (topLeft.x + bottomRight.x) / 2;
  const total = size.barWidthPx + TEXT_BAR_HINT_GAP_PX + size.hintWidthPx;
  const leftmost = size.leftClearancePx + TEXT_BAR_MARGIN_PX;
  const rightmost = camera.viewportWidthPx - size.rightClearancePx - TEXT_BAR_MARGIN_PX - total;
  const left = Math.max(leftmost, Math.min(centreX - size.barWidthPx / 2, rightmost));
  const above = topLeft.y - TEXT_BAR_GAP_PX;
  if (above - TEXT_BAR_HEIGHT_PX >= 0) return { left, y: above, side: 'above' };
  return { left, y: bottomRight.y + TEXT_BAR_GAP_PX, side: 'below' };
}

/**
 * The world bounds of the box of the object whose text is edited, its parents' frames composed:
 * a text object's, sticky note's or shape's own box (not the shadow the engine's culling bounds
 * take in), else, for a connector's label, its drawn bounds (`worldBoundsOf`). Pure.
 *
 * @param board - The document.
 * @param id - The edited object.
 * @returns The bounds, or undefined when it is gone or has no geometry.
 */
export function editedBoundsOf(
  board: Pick<BoardReader, 'get'>,
  id: ObjectId,
): WorldBounds | undefined {
  const object = board.get(id);
  if (object === undefined) return undefined;
  const transform = worldTransformOf(object, { get: (key) => board.get(key) });
  if (!('width' in object) || !('height' in object)) return worldBoundsOf(object, transform);
  const { width, height } = object;
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ].map(({ x, y }) => ({
    x: transform.cos * x - transform.sin * y + transform.x,
    y: transform.sin * x + transform.cos * y + transform.y,
  }));
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

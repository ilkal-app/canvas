import type { Rgba } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';

/** One object board search found: where it is and whether it is the active result. */
export interface SearchHighlightBox {
  /** Its bounds, world units. */
  readonly bounds: WorldBounds;
  /** Whether it is the sheet's active result, drawn heavier and filled. */
  readonly isActive: boolean;
}

/**
 * What the board search highlight shows while the sheet is open: the outlined objects
 * and the colour they are outlined in (the person's colour of the theme). Plain data, so it
 * crosses to the engine worker.
 */
export interface SearchHighlightModel {
  /** The objects, in the sheet's order. */
  readonly boxes: readonly SearchHighlightBox[];
  /** The outline's colour; the active fill is it at {@link SEARCH_HIGHLIGHT_FILL_ALPHA}. */
  readonly color: Readonly<Rgba>;
}

/** Nothing highlighted: a closed sheet or a query that finds nothing. */
export const EMPTY_SEARCH_HIGHLIGHT: SearchHighlightModel = Object.freeze({
  boxes: Object.freeze([]),
  color: Object.freeze([0, 0, 0, 0] as Rgba),
});

/** How much of the colour fills the active result's box. */
export const SEARCH_HIGHLIGHT_FILL_ALPHA = 0.08;

/** The outline's width, CSS px. */
export const SEARCH_HIGHLIGHT_OUTLINE_PX = 1.5;

/** The active result's outline width, CSS px. */
export const SEARCH_HIGHLIGHT_ACTIVE_OUTLINE_PX = 2.5;

/** How far the outline stands off the object, CSS px, so it never covers its edge. */
export const SEARCH_HIGHLIGHT_PADDING_PX = 4;

/** One rectangle of the highlight, world units. */
export interface SearchHighlightRect {
  /** Its left edge. */
  readonly x: number;
  /** Its top edge. */
  readonly y: number;
  /** Its width. */
  readonly width: number;
  /** Its height. */
  readonly height: number;
  /** Its colour. */
  readonly color: Readonly<Rgba>;
}

/**
 * Whether a value is a plain record.
 *
 * @param value - The value.
 * @returns True for a non-null object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/**
 * Whether a value is a finite number.
 *
 * @param value - The value.
 * @returns True for a finite number.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether a value is a box: finite bounds whose minimum is not past their maximum, and a flag.
 *
 * @param value - The value.
 * @returns True for a box.
 */
function isBox(value: unknown): value is SearchHighlightBox {
  if (!isRecord(value) || !isRecord(value.bounds) || typeof value.isActive !== 'boolean') {
    return false;
  }
  const { bounds } = value;
  return (
    ['minX', 'minY', 'maxX', 'maxY'].every((key) => isFiniteNumber(bounds[key])) &&
    (bounds.minX as number) <= (bounds.maxX as number) &&
    (bounds.minY as number) <= (bounds.maxY as number)
  );
}

/**
 * Whether a value from the app is a {@link SearchHighlightModel}, checked where it reaches the
 * engine (`createSearchHighlightLayer`).
 *
 * @param value - The value.
 * @returns True for a model.
 */
export function isSearchHighlightModel(value: unknown): value is SearchHighlightModel {
  if (!isRecord(value) || !Array.isArray(value.boxes) || !Array.isArray(value.color)) return false;
  return value.color.length === 4 && value.color.every(isFiniteNumber) && value.boxes.every(isBox);
}

/**
 * A line width in world units: whole device pixels, at least one, as the trace tint snaps.
 *
 * @param cssPx - The width, CSS px.
 * @param zoom - The camera's zoom.
 * @param dpr - Device pixels per CSS px.
 * @returns The width, world units.
 */
function lineWidth(cssPx: number, zoom: number, dpr: number): number {
  return Math.max(1, Math.round(cssPx * dpr)) / dpr / zoom;
}

/**
 * The highlight's rectangles at a zoom, world units: per box, its box padded by
 * {@link SEARCH_HIGHLIGHT_PADDING_PX} as four edges that do not overlap (top and bottom full
 * width, the sides between them), 1.5 px wide, or 2.5 px for the active result, whose fill comes
 * first. Pure.
 *
 * @param model - The highlight.
 * @param zoom - The camera's zoom.
 * @param dpr - Device pixels per CSS px.
 * @returns The rectangles, in drawing order.
 */
export function searchHighlightRectsOf(
  model: SearchHighlightModel,
  zoom: number,
  dpr = 1,
): SearchHighlightRect[] {
  const pad = SEARCH_HIGHLIGHT_PADDING_PX / zoom;
  const { color } = model;
  return model.boxes.flatMap(({ bounds, isActive }) => {
    const line = lineWidth(
      isActive ? SEARCH_HIGHLIGHT_ACTIVE_OUTLINE_PX : SEARCH_HIGHLIGHT_OUTLINE_PX,
      zoom,
      dpr,
    );
    const x = bounds.minX - pad;
    const y = bounds.minY - pad;
    const width = bounds.maxX + pad - x;
    const height = bounds.maxY + pad - y;
    const inner = Math.max(0, height - 2 * line);
    const edges: SearchHighlightRect[] = [
      { x, y, width, height: line, color },
      { x, y: y + height - line, width, height: line, color },
      { x, y: y + line, width: line, height: inner, color },
      { x: x + width - line, y: y + line, width: line, height: inner, color },
    ];
    if (!isActive) return edges;
    const fill: Rgba = [color[0], color[1], color[2], color[3] * SEARCH_HIGHLIGHT_FILL_ALPHA];
    return [{ x, y, width, height, color: fill }, ...edges];
  });
}

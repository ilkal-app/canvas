import type { Rgba } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';

/**
 * One agent's trace sheet as the tint draws it: the union of the world bounds of the
 * objects on the sheet, and the agent's colour. The page works both out; the engine only draws.
 */
export interface TraceTintSheet {
  /** The union of the sheet's objects' world bounds, world units. */
  readonly bounds: WorldBounds;
  /** The agent's colour, straight alpha, channels 0 to 1; the tint takes its own alphas. */
  readonly color: Rgba;
}

/** What the trace tint shows: every open sheet, in drawing order. */
export interface TraceTintModel {
  /** The sheets; none draws nothing. */
  readonly sheets: readonly TraceTintSheet[];
}

/** No sheet open: the tint draws nothing and uploads nothing. */
export const EMPTY_TRACE_TINT: TraceTintModel = Object.freeze({ sheets: Object.freeze([]) });

/** How opaque the sheet's fill is over the objects it holds (Figma `trace sheet`, node 7:421). */
export const TRACE_TINT_FILL_ALPHA = 0.08;

/**
 * How thick the sheet's outline is on screen, CSS px, at every zoom (Figma's 1.5 px), rounded to
 * whole device pixels where it is drawn, so its inner edge never lies on a pixel centre, where
 * the two backends' rasterisers may round apart (WebGL2's framebuffer is stored bottom-up).
 */
export const TRACE_TINT_OUTLINE_PX = 1.5;

/** How far the sheet reaches past its objects on the left, right and bottom, CSS px. */
export const TRACE_TINT_PADDING_PX = 16;

/**
 * How far the sheet reaches above its objects, CSS px: room for the sheet's tab (the agent's
 * name, Keep and Lift off), which the app draws there.
 */
export const TRACE_TINT_HEADER_PX = 56;

/** One flat rectangle of the tint, axis-aligned, in world units. */
export interface TraceTintRect {
  /** Left edge, world units. */
  readonly x: number;
  /** Top edge, world units. */
  readonly y: number;
  /** Width, world units. */
  readonly width: number;
  /** Height, world units. */
  readonly height: number;
  /** Straight-alpha colour. */
  readonly color: Rgba;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSheet(value: unknown): value is TraceTintSheet {
  if (!isRecord(value) || !isRecord(value.bounds)) return false;
  const { bounds, color } = value;
  return (
    ['minX', 'minY', 'maxX', 'maxY'].every((key) => isFiniteNumber(bounds[key])) &&
    (bounds.minX as number) <= (bounds.maxX as number) &&
    (bounds.minY as number) <= (bounds.maxY as number) &&
    Array.isArray(color) &&
    color.length === 4 &&
    color.every(isFiniteNumber)
  );
}

/**
 * Checks a trace tint model that crossed a thread: a list of sheets, each with finite,
 * ordered bounds and a four-channel colour. Pure.
 *
 * @param value - The received model.
 * @returns Whether it is a well-formed {@link TraceTintModel}.
 */
export function isTraceTintModel(value: unknown): value is TraceTintModel {
  return isRecord(value) && Array.isArray(value.sheets) && value.sheets.every(isSheet);
}

/**
 * The rectangles that draw a model at a zoom: per sheet, a translucent fill over its padded
 * bounds ({@link TRACE_TINT_FILL_ALPHA}) and its outline, four opaque bands
 * {@link TRACE_TINT_OUTLINE_PX} wide (in whole device pixels, at least one) inside the padded
 * edge. Padding and outline are screen sizes, so they are divided by the zoom; nothing else
 * depends on the camera, so a pan keeps the rectangles. Pure.
 *
 * @param model - The sheets.
 * @param zoom - The camera zoom, screen px per world unit; positive.
 * @param dpr - Device pixels per CSS pixel; 1 if absent.
 * @returns The rectangles, fill before outline, sheet by sheet.
 */
export function traceTintRectsOf(model: TraceTintModel, zoom: number, dpr = 1): TraceTintRect[] {
  const unit = 1 / zoom;
  const pad = TRACE_TINT_PADDING_PX * unit;
  const line = (Math.max(1, Math.round(TRACE_TINT_OUTLINE_PX * dpr)) / dpr) * unit;
  return model.sheets.flatMap(({ bounds, color }) => {
    const x = bounds.minX - pad;
    const y = bounds.minY - TRACE_TINT_HEADER_PX * unit;
    const width = bounds.maxX + pad - x;
    const height = bounds.maxY + pad - y;
    const fill: Rgba = [color[0], color[1], color[2], color[3] * TRACE_TINT_FILL_ALPHA];
    const inner = Math.max(0, height - 2 * line);
    return [
      { x, y, width, height, color: fill },
      { x, y, width, height: line, color },
      { x, y: y + height - line, width, height: line, color },
      { x, y: y + line, width: line, height: inner, color },
      { x: x + width - line, y: y + line, width: line, height: inner, color },
    ];
  });
}

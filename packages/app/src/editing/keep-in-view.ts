// What the canvas keeps clear of the chrome below 768 px wide: the selection's handles
// and the text being edited, never under the compact bottom bar, a sheet, the format bar or the
// on-screen keyboard. The camera has no command of its own for this, so the shell pans it as a
// wheel over the canvas would (`useKeepInView`), through the camera's own input.

import { worldToScreen, type Camera, type WorldBounds } from '@canvas/engine';

/** A vertical span on the page, CSS px from the viewport's top. */
export interface ScreenSpan {
  /** Its top edge. */
  readonly top: number;
  /** Its bottom edge. */
  readonly bottom: number;
}

/** The room kept around what is kept in view, CSS px: a selection handle's reach and a gap. */
export const KEEP_IN_VIEW_MARGIN_PX = 16;

/**
 * How far to scroll the canvas so a span is inside the visible span, as a wheel's `deltaY`, CSS
 * px: positive moves the board up, negative down, zero when it is in view already. A span taller
 * than the visible one is placed by its top. Each edge keeps `marginPx`. Pure.
 *
 * @param subject - What must show: its top and bottom, CSS px.
 * @param visible - Where the canvas shows, clear of the chrome, CSS px.
 * @param marginPx - The room kept at each edge, CSS px.
 * @returns The wheel delta, CSS px.
 */
export function keepInViewDeltaPx(
  subject: ScreenSpan,
  visible: ScreenSpan,
  marginPx: number = KEEP_IN_VIEW_MARGIN_PX,
): number {
  const top = subject.top - marginPx;
  const bottom = subject.bottom + marginPx;
  if (top >= visible.top && bottom <= visible.bottom) return 0;
  if (bottom - top > visible.bottom - visible.top || top < visible.top) return top - visible.top;
  return bottom - visible.bottom;
}

/**
 * The union of world bounds, or undefined for none. Pure.
 *
 * @param bounds - The bounds.
 * @returns Their union.
 */
export function unionOfBounds(bounds: readonly WorldBounds[]): WorldBounds | undefined {
  const [first, ...rest] = bounds;
  if (first === undefined) return undefined;
  return rest.reduce(
    (union, each) => ({
      minX: Math.min(union.minX, each.minX),
      minY: Math.min(union.minY, each.minY),
      maxX: Math.max(union.maxX, each.maxX),
      maxY: Math.max(union.maxY, each.maxY),
    }),
    first,
  );
}

/**
 * Where world bounds show vertically on the page under a camera, the canvas's top edge at
 * `canvasTopPx`. Pure.
 *
 * @param bounds - The bounds, world units.
 * @param camera - The camera.
 * @param canvasTopPx - The canvas's top edge on the page, CSS px.
 * @returns Their span on the page, CSS px.
 */
export function screenSpanOf(bounds: WorldBounds, camera: Camera, canvasTopPx: number): ScreenSpan {
  const top = worldToScreen(camera, { x: bounds.minX, y: bounds.minY }).y;
  const bottom = worldToScreen(camera, { x: bounds.maxX, y: bounds.maxY }).y;
  return { top: canvasTopPx + top, bottom: canvasTopPx + bottom };
}

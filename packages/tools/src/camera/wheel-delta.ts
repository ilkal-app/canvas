/**
 * The pixels one line of wheel scrolling moves (`WheelEvent.DOM_DELTA_LINE`), as the prototype
 * scaled it (webgl-whiteboard `src/app/controller.ts`, `onWheel`).
 */
export const LINE_HEIGHT_PX = 16;

/**
 * Converts a wheel delta to CSS pixels whatever unit the browser reported it in: pixels
 * (`deltaMode` 0, trackpads and most mice), lines (1, Firefox mice) or pages (2).
 *
 * @param delta - `deltaX` or `deltaY` as the event carries it.
 * @param deltaMode - The event's `deltaMode`: 0, 1 or 2.
 * @param pageHeightPx - One page, CSS px: the viewport height.
 * @returns The delta in CSS px.
 * @throws {RangeError} When `deltaMode` is not 0, 1 or 2.
 */
export function wheelDeltaPx(delta: number, deltaMode: number, pageHeightPx: number): number {
  switch (deltaMode) {
    case 0:
      return delta;
    case 1:
      return delta * LINE_HEIGHT_PX;
    case 2:
      return delta * pageHeightPx;
    default:
      throw new RangeError(`Unknown wheel delta mode ${String(deltaMode)}.`);
  }
}

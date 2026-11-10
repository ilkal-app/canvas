import type { ScreenPoint } from '@canvas/tools';

// A pointer event's pressure and the samples the browser coalesced into it: the draw
// tool records the whole path the pointer took between two `pointermove`s, and a pen's pressure.

/** One sample the browser coalesced into a `pointermove`, CSS px on the canvas. */
export interface ScreenSample {
  /** Where the pointer was, CSS px on the canvas. */
  readonly screen: ScreenPoint;
  /** The pen pressure from 0 to 1, when the device reports one (`pressureOf`). */
  readonly pressure?: number;
}

/** The pressures a browser reports for a device without a pressure sensor. */
const UNSENSED_PRESSURES: readonly number[] = [0, 0.5, 1];

/**
 * The pressure a pointer event reports, when its device senses one: always for a pen, and for a
 * finger only when it is not exactly 0, 0.5 or 1, the values a browser gives a touch screen
 * without a sensor. A mouse has none.
 *
 * @param event - The pointer event, or a mouse event (no pressure).
 * @returns The pressure from 0 to 1, or undefined.
 */
export function pressureOf(event: MouseEvent): number | undefined {
  if (!('pointerType' in event && 'pressure' in event)) return undefined;
  const pointer = event as PointerEvent;
  if (pointer.pointerType === 'pen') return pointer.pressure;
  if (pointer.pointerType === 'touch' && !UNSENSED_PRESSURES.includes(pointer.pressure)) {
    return pointer.pressure;
  }
  return undefined;
}

/**
 * The raw samples the browser coalesced into a `pointermove`, in order: all of
 * `getCoalescedEvents()`, the last included. The event's own point is an aggregate the browser may
 * have processed, so its position and pressure need not equal the last raw sample's
 * (Pointer Events §9.1); the draw tool keeps the raw ones. Empty where the browser has no
 * `getCoalescedEvents` or coalesced nothing.
 *
 * @param event - The `pointermove`.
 * @param origin - The canvas's top-left corner, client px.
 * @param origin.left - Its left edge.
 * @param origin.top - Its top edge.
 * @returns The raw samples, CSS px on the canvas.
 */
export function coalescedTrailOf(
  event: PointerEvent,
  origin: { readonly left: number; readonly top: number },
): ScreenSample[] {
  const coalesced =
    typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
  return coalesced.map((sample) => {
    const screen = { x: sample.clientX - origin.left, y: sample.clientY - origin.top };
    const pressure = pressureOf(sample);
    return pressure === undefined ? { screen } : { screen, pressure };
  });
}

import type { EngineHost, PointerInputType } from '@canvas/engine';

/** The DOM pointer events the engine receives, and what each is to it. */
const POINTER_INPUT_TYPES = {
  pointerdown: 'down',
  pointermove: 'move',
  pointerup: 'up',
  pointercancel: 'cancel',
} as const satisfies Record<string, PointerInputType>;

type ForwardedEventType = keyof typeof POINTER_INPUT_TYPES;

const FORWARDED_EVENT_TYPES = Object.keys(POINTER_INPUT_TYPES) as ForwardedEventType[];

function isForwardedEventType(type: string): type is ForwardedEventType {
  return Object.hasOwn(POINTER_INPUT_TYPES, type);
}

/**
 * Forwards the canvas's pointer events to the engine with their original timestamps, in CSS
 * px from the canvas's top-left corner. A move's coalesced events are forwarded one by one, each
 * with its own time, where the browser provides them; the engine coalesces per frame again. The
 * select tool's input binding captures a primary-button press (`bindSelectInput`), so a drag
 * released outside the canvas still reaches it, and its `up` is forwarded too. Main thread.
 *
 * @param canvas - The canvas the engine draws into.
 * @param host - The engine.
 * @returns Stops forwarding.
 */
export function forwardPointerEvents(
  canvas: HTMLCanvasElement,
  host: Pick<EngineHost, 'pointer'>,
): () => void {
  const listener = (event: PointerEvent): void => {
    if (!isForwardedEventType(event.type)) return;
    const type = POINTER_INPUT_TYPES[event.type];
    const bounds = canvas.getBoundingClientRect();
    // Not every browser (nor jsdom) has coalesced events.
    const coalesced =
      type === 'move' && 'getCoalescedEvents' in event ? event.getCoalescedEvents() : [];
    for (const each of coalesced.length > 0 ? coalesced : [event]) {
      host.pointer({
        type,
        xPx: each.clientX - bounds.left,
        yPx: each.clientY - bounds.top,
        buttons: each.buttons,
        pointerId: each.pointerId,
        timestampMs: each.timeStamp,
      });
    }
  };
  for (const type of FORWARDED_EVENT_TYPES) canvas.addEventListener(type, listener);
  return () => {
    for (const type of FORWARDED_EVENT_TYPES) canvas.removeEventListener(type, listener);
  };
}

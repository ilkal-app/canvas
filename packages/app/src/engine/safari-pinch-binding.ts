import type { CameraInput, ScreenPoint } from '@canvas/tools';

/**
 * The fields of Safari's `GestureEvent` a pinch reads. lib.dom does not declare the type, and
 * only Safari has it.
 */
interface GestureEventLike extends Event {
  /** The pinch's scale since `gesturestart`: 1 at the start, above 1 spread apart. */
  readonly scale: number;
  /** The cursor, viewport CSS px. */
  readonly clientX: number;
  /** The cursor, viewport CSS px. */
  readonly clientY: number;
}

/**
 * Binds Safari's trackpad pinch. Safari reports it as `gesturestart`, `gesturechange` and
 * `gestureend` events carrying a cumulative `scale`, not as the Control-wheel events Chrome and
 * Firefox send, and zooms the whole page unless their default is prevented. Each change becomes
 * a `pinch` step (the scale since the previous change) about the cursor. On iOS the same events
 * accompany a two-finger touch the pointer events already carry, so they are ignored while
 * `isTouchActive` says two touch pointers are down. Does nothing where the browser has no
 * `GestureEvent`. Main thread.
 *
 * @param canvas - The canvas the engine draws into.
 * @param pointOf - Converts a viewport point to CSS px on the canvas.
 * @param isTouchActive - Whether the touch pointers already carry a two-finger gesture.
 * @param onInput - Receives each pinch step.
 * @returns A function that removes the listeners.
 */
export function bindSafariPinch(
  canvas: HTMLCanvasElement,
  pointOf: (event: { clientX: number; clientY: number }) => ScreenPoint,
  isTouchActive: () => boolean,
  onInput: (input: CameraInput) => void,
): () => void {
  // On WebKit, tooling/scenario's safari-pinch.spec.ts drives these events.
  if (!('GestureEvent' in globalThis)) return () => undefined;
  let lastScale = 1;
  const onGestureStart = (event: Event): void => {
    event.preventDefault();
    lastScale = 1;
  };
  const onGestureChange = (event: Event): void => {
    event.preventDefault();
    const { scale } = event as GestureEventLike;
    if (isTouchActive() || !(scale > 0) || !Number.isFinite(scale)) return;
    const step = scale / lastScale;
    lastScale = scale;
    if (step !== 1) {
      onInput({ kind: 'pinch', center: pointOf(event as GestureEventLike), scale: step });
    }
  };
  const onGestureEnd = (event: Event): void => {
    event.preventDefault();
  };
  canvas.addEventListener('gesturestart', onGestureStart);
  canvas.addEventListener('gesturechange', onGestureChange);
  canvas.addEventListener('gestureend', onGestureEnd);
  return () => {
    canvas.removeEventListener('gesturestart', onGestureStart);
    canvas.removeEventListener('gesturechange', onGestureChange);
    canvas.removeEventListener('gestureend', onGestureEnd);
  };
}

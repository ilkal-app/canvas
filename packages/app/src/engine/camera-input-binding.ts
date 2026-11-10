import { TwoFingerGesture, wheelDeltaPx, type CameraInput, type ScreenPoint } from '@canvas/tools';

import { bindSafariPinch } from './safari-pinch-binding.js';
import { bindSpacePan } from './space-pan-binding.js';

/** The mouse button that pans the view when dragged (the prototype's middle-button pan). */
const MIDDLE_BUTTON = 1;

/**
 * Listens to the canvas's wheel and pointer events and reports the camera input they mean,
 * normalised for `@canvas/tools` (CSS px on the canvas, wheel deltas in px): the wheel (a
 * trackpad pinch arrives as a Control-wheel in Chrome and Firefox, as gesture events in Safari:
 * `bindSafariPinch`), two touch points (pan and pinch, through `TwoFingerGesture`) and a
 * middle-button drag, and a primary-button drag with Space held (`bindSpacePan`), from
 * any tool. The wheel's default is always prevented, so the
 * page neither scrolls nor zooms under the canvas; primary-button and single-finger input is left
 * to the tools. Keys reach the camera through the shell's shortcut registry instead, which
 * applies the editable-target guard. Main thread.
 *
 * @param canvas - The canvas the engine draws into.
 * @param onInput - Receives each input, in event order.
 * @returns A function that removes the listeners.
 */
export function bindCameraInput(
  canvas: HTMLCanvasElement,
  onInput: (input: CameraInput) => void,
): () => void {
  const touches = new TwoFingerGesture();
  let middleDrag: { pointerId: number; last: ScreenPoint } | undefined;
  const pointOf = (event: { clientX: number; clientY: number }): ScreenPoint => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const pageHeightPx = canvas.getBoundingClientRect().height;
    onInput({
      kind: 'wheel',
      point: pointOf(event),
      deltaXPx: wheelDeltaPx(event.deltaX, event.deltaMode, pageHeightPx),
      deltaYPx: wheelDeltaPx(event.deltaY, event.deltaMode, pageHeightPx),
      isZoomModifierPressed: event.ctrlKey || event.metaKey,
    });
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      touches.pointerDown(event.pointerId, pointOf(event));
    } else if (event.button === MIDDLE_BUTTON) {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      middleDrag = { pointerId: event.pointerId, last: pointOf(event) };
    }
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      for (const input of touches.pointerMove(event.pointerId, pointOf(event))) onInput(input);
    } else if (middleDrag?.pointerId === event.pointerId) {
      const point = pointOf(event);
      const { last } = middleDrag;
      middleDrag.last = point;
      onInput({ kind: 'drag', deltaXPx: point.x - last.x, deltaYPx: point.y - last.y });
    }
  };
  const onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') touches.pointerUp(event.pointerId);
    else if (middleDrag?.pointerId === event.pointerId) middleDrag = undefined;
  };
  const onMouseDown = (event: MouseEvent): void => {
    // A middle-button press would otherwise start the browser's autoscroll.
    if (event.button === MIDDLE_BUTTON) event.preventDefault();
  };

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerEnd);
  canvas.addEventListener('lostpointercapture', onPointerEnd);
  canvas.addEventListener('mousedown', onMouseDown);
  const unbindSafariPinch = bindSafariPinch(canvas, pointOf, () => touches.isActive, onInput);
  const unbindSpacePan = bindSpacePan(canvas, pointOf, onInput);
  return () => {
    unbindSpacePan();
    unbindSafariPinch();
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerEnd);
    canvas.removeEventListener('pointercancel', onPointerEnd);
    canvas.removeEventListener('lostpointercapture', onPointerEnd);
    canvas.removeEventListener('mousedown', onMouseDown);
  };
}

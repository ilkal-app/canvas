import type { CameraInput, ScreenPoint } from '@canvas/tools';

import { isEditableTarget } from '../focus/editable-target.js';
import { isInteractiveTarget } from '../focus/interactive-target.js';
import { isImeKey } from '../shortcuts/ime-key.js';

/** The primary mouse button. */
const PRIMARY_BUTTON = 0;

/**
 * Pans the view with a primary-button drag while Space is held, from any tool, as the
 * middle-button drag does: the press and its drag never reach the active tool, which a capture
 * listener on the canvas ensures, whatever order the tools' listeners were added in. Space counts
 * only where it would not type or press a control (a text field, a focused button), and is let go
 * when the window loses focus. Touch is left to the two-finger pan. Main thread.
 *
 * @param canvas - The canvas the engine draws into.
 * @param pointOf - A pointer event's point on the canvas, CSS px.
 * @param onInput - Receives each `drag` input.
 * @returns A function that removes the listeners.
 */
export function bindSpacePan(
  canvas: HTMLCanvasElement,
  pointOf: (event: { clientX: number; clientY: number }) => ScreenPoint,
  onInput: (input: CameraInput) => void,
): () => void {
  let isSpaceHeld = false;
  let drag: { pointerId: number; last: ScreenPoint } | undefined;
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== ' ' || isImeKey(event)) return;
    const target = event.composedPath()[0] ?? event.target;
    if (isEditableTarget(target) || isInteractiveTarget(target)) return;
    // The page would scroll on Space.
    event.preventDefault();
    isSpaceHeld = true;
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ') isSpaceHeld = false;
  };
  const onBlur = (): void => {
    isSpaceHeld = false;
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!isSpaceHeld || event.pointerType === 'touch' || event.button !== PRIMARY_BUTTON) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    canvas.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, last: pointOf(event) };
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (drag?.pointerId !== event.pointerId) return;
    event.stopImmediatePropagation();
    const point = pointOf(event);
    const { last } = drag;
    drag.last = point;
    onInput({ kind: 'drag', deltaXPx: point.x - last.x, deltaYPx: point.y - last.y });
  };
  const onPointerEnd = (event: PointerEvent): void => {
    if (drag?.pointerId !== event.pointerId) return;
    event.stopImmediatePropagation();
    drag = undefined;
  };
  const capture = { capture: true } as const;
  // The page the canvas is on hears the keys; a canvas outside any page (tests) has none.
  const page = (canvas.ownerDocument as Document | undefined)?.defaultView ?? undefined;
  page?.addEventListener('keydown', onKeyDown);
  page?.addEventListener('keyup', onKeyUp);
  page?.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown, capture);
  canvas.addEventListener('pointermove', onPointerMove, capture);
  canvas.addEventListener('pointerup', onPointerEnd, capture);
  canvas.addEventListener('pointercancel', onPointerEnd, capture);
  return () => {
    page?.removeEventListener('keydown', onKeyDown);
    page?.removeEventListener('keyup', onKeyUp);
    page?.removeEventListener('blur', onBlur);
    canvas.removeEventListener('pointerdown', onPointerDown, capture);
    canvas.removeEventListener('pointermove', onPointerMove, capture);
    canvas.removeEventListener('pointerup', onPointerEnd, capture);
    canvas.removeEventListener('pointercancel', onPointerEnd, capture);
  };
}

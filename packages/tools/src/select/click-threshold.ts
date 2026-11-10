import type { ScreenPoint } from '../camera/camera-moves.js';

import type { SelectPointer, SelectPointerType } from './select-input.js';
import { LONG_PRESS_SLOP_PX } from './touch-gestures.js';

/**
 * How far the pointer must travel from a press, CSS px, before the press becomes a drag (the
 * prototype's `CLICK_THRESHOLD_PX`, webgl-whiteboard `src/app/controller.ts`).
 */
export const CLICK_THRESHOLD_PX = 4;

/**
 * How far a press must travel before it drags, CSS px, for a kind of pointer: a finger's
 * contact wobbles, so touch waits for {@link LONG_PRESS_SLOP_PX} (the long-press's own slop),
 * a mouse or a pen for {@link CLICK_THRESHOLD_PX}.
 *
 * @param pointerType - The pointer; `mouse` if absent.
 * @returns The threshold, CSS px.
 */
export function clickThresholdPx(pointerType: SelectPointerType = 'mouse'): number {
  return pointerType === 'touch' ? LONG_PRESS_SLOP_PX : CLICK_THRESHOLD_PX;
}

/**
 * Whether the pointer has travelled far enough from a press to drag (and, for a finger, too
 * far for a long-press): {@link clickThresholdPx} of the press's pointer, on screen. Pure.
 *
 * @param start - The press.
 * @param screen - Where the pointer is now, CSS px on the viewport.
 * @returns True at or past the threshold.
 */
export function isPastClickThreshold(start: SelectPointer, screen: ScreenPoint): boolean {
  const dx = screen.x - start.screen.x;
  const dy = screen.y - start.screen.y;
  return Math.hypot(dx, dy) >= clickThresholdPx(start.pointerType);
}

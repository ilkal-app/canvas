import type { ObjectId } from '@canvas/schema';

import type { ScreenPoint } from '../camera/camera-moves.js';

/**
 * How long a finger stays down, ms, before the press opens the context menu: Android's long-press
 * timeout.
 */
export const LONG_PRESS_MS = 500;

/**
 * How far a finger may wander, CSS px, and still count as a press held in place: a long-press,
 * or a tap. A finger that moves further drags. A fingertip's contact wobbles more than a mouse,
 * so this is twice the mouse's click threshold.
 */
export const LONG_PRESS_SLOP_PX = 8;

/**
 * Whether a touch press held until `timeStamp` is a long-press: at least {@link LONG_PRESS_MS}
 * since it landed. The select tool asks this only while the press has not moved past
 * {@link LONG_PRESS_SLOP_PX}, since a press that moved further is a drag. Pure.
 *
 * @param pressedAt - When the finger landed, ms (the press's `timeStamp`).
 * @param timeStamp - The time now, ms, on the same clock.
 * @returns True once the press has been held long enough.
 */
export function isLongPress(pressedAt: number, timeStamp: number): boolean {
  return timeStamp - pressedAt >= LONG_PRESS_MS;
}

/**
 * What a finger's double-tap zooms to where it activates nothing: the
 * selection, or the whole board when nothing is selected.
 */
export type DoubleTapFit = 'selection' | 'board';

/** Where the select tool's touch and context menu requests go. */
export interface TouchCallbacks {
  /**
   * Opens the context menu at a point: a finger's long-press (`isTouch`) or a secondary click.
   */
  readonly onContextMenu?: (screen: ScreenPoint, isTouch: boolean) => void;
  /**
   * Called on a finger's double-tap that activates nothing: on empty board, or on an object
   * that is not a group and has nothing to edit (`canActivate`); never with an activation. The
   * app zooms to fit what it names.
   */
  readonly onDoubleTap?: (fit: DoubleTapFit) => void;
  /**
   * Called as a finger drags from empty board, with how far it moved since the last
   * call, CSS px: the app pans the view by as much, so the board follows the finger. A mouse or a
   * pen draws a marquee there instead. The view stays put if absent.
   */
  readonly onPan?: (deltaXPx: number, deltaYPx: number) => void;
  /**
   * Whether an object has an interaction of its own that `onActivate` runs (a mode registered
   * for its type, such as editing a text). A finger's
   * double-tap on an object that is not a group and has none zooms to it instead. None has one
   * if absent.
   */
  readonly canActivate?: (id: ObjectId) => boolean;
}

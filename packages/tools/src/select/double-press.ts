import type { ObjectId } from '@canvas/schema';

import type { ScreenPoint } from '../camera/camera-moves.js';

import type { SelectPointer, SelectPointerType } from './select-input.js';

/**
 * The longest time between two primary presses that makes them a double press, ms.
 */
export const DOUBLE_PRESS_INTERVAL_MS = 400;

/** The farthest apart two presses of a double press may be, CSS px, for a mouse or a pen. */
export const DOUBLE_PRESS_DISTANCE_PX = 4;

/**
 * The farthest apart two taps of a double-tap may be, CSS px: a
 * fingertip lands less precisely than a mouse, so a finger's double press allows more.
 */
export const DOUBLE_TAP_DISTANCE_PX = 32;

/**
 * How far apart two presses of a double press may be for a kind of pointer:
 * {@link DOUBLE_TAP_DISTANCE_PX} for touch, {@link DOUBLE_PRESS_DISTANCE_PX} for a mouse or a
 * pen. The interval, {@link DOUBLE_PRESS_INTERVAL_MS}, is the same for both.
 *
 * @param pointerType - The pointer; `mouse` if absent.
 * @returns The distance, CSS px.
 */
export function doublePressDistancePx(pointerType: SelectPointerType = 'mouse'): number {
  return pointerType === 'touch' ? DOUBLE_TAP_DISTANCE_PX : DOUBLE_PRESS_DISTANCE_PX;
}

/**
 * A press that ended as a click: what it pressed, where and when, the first half of a double
 * press. Presses on objects are remembered for every pointer; a finger's press on empty board
 * too, for the double-tap that zooms (`id` null).
 */
export interface PressStamp {
  /** The object pressed (`PointHit.id`), or null for a finger's press on empty board. */
  readonly id: ObjectId | null;
  /** Where, CSS px on the viewport. */
  readonly screen: ScreenPoint;
  /** When, ms. */
  readonly timeStamp: number;
}

/**
 * The stamp of a press, for the next press to compare with; none without a timestamp.
 *
 * @param press - The press.
 * @param id - The object it landed on, or null for empty board.
 * @returns The stamp, or undefined.
 */
export function stampOf(press: SelectPointer, id: ObjectId | null): PressStamp | undefined {
  return press.timeStamp === undefined
    ? undefined
    : { id, screen: press.screen, timeStamp: press.timeStamp };
}

/**
 * Whether a press is the second of a double press: it lands on the same object (or, for a
 * finger, on empty board again) as a click at most {@link DOUBLE_PRESS_INTERVAL_MS} before it
 * that pressed less than {@link doublePressDistancePx} away: 4 CSS px for a mouse or a pen,
 * 32 px for a finger (a double-tap). Pure.
 *
 * @param previous - The last click's press, if any.
 * @param press - The new press.
 * @param id - The object the new press landed on, or null for empty board.
 * @returns True for a double press.
 */
export function isDoublePress(
  previous: PressStamp | undefined,
  press: SelectPointer,
  id: ObjectId | null,
): boolean {
  if (previous === undefined || press.timeStamp === undefined || previous.id !== id) return false;
  const elapsed = press.timeStamp - previous.timeStamp;
  const distance = Math.hypot(
    press.screen.x - previous.screen.x,
    press.screen.y - previous.screen.y,
  );
  return (
    elapsed >= 0 &&
    elapsed <= DOUBLE_PRESS_INTERVAL_MS &&
    distance < doublePressDistancePx(press.pointerType)
  );
}

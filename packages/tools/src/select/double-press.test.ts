import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import {
  DOUBLE_PRESS_DISTANCE_PX,
  DOUBLE_PRESS_INTERVAL_MS,
  DOUBLE_TAP_DISTANCE_PX,
  doublePressDistancePx,
  isDoublePress,
  stampOf,
} from './double-press.js';
import type { SelectPointer, SelectPointerType } from './select-input.js';

const A = 'a' as ObjectId;

/**
 * A press at a screen point and time.
 *
 * @param x - Where, CSS px along x (y is 0).
 * @param timeStamp - When, ms.
 * @param pointerType - The pointer.
 * @returns The press.
 */
function press(x: number, timeStamp: number, pointerType?: SelectPointerType): SelectPointer {
  return {
    screen: { x, y: 0 },
    world: { x, y: 0 },
    isShiftPressed: false,
    isModPressed: false,
    timeStamp,
    ...(pointerType === undefined ? {} : { pointerType }),
  };
}

describe('isDoublePress', () => {
  it('allows 4 CSS px for a mouse or a pen and 32 for a finger, 400 ms for both', () => {
    expect(doublePressDistancePx()).toBe(DOUBLE_PRESS_DISTANCE_PX);
    expect(doublePressDistancePx('pen')).toBe(4);
    expect(doublePressDistancePx('touch')).toBe(DOUBLE_TAP_DISTANCE_PX);
    expect(DOUBLE_TAP_DISTANCE_PX).toBe(32);
    const mouse = stampOf(press(100, 1_000), A);
    expect(isDoublePress(mouse, press(103.9, 1_000 + DOUBLE_PRESS_INTERVAL_MS), A)).toBe(true);
    expect(isDoublePress(mouse, press(104, 1_100), A)).toBe(false);
    const finger = stampOf(press(100, 1_000, 'touch'), A);
    expect(isDoublePress(finger, press(131.9, 1_400, 'touch'), A)).toBe(true);
    expect(isDoublePress(finger, press(132, 1_100, 'touch'), A)).toBe(false);
    expect(isDoublePress(finger, press(100, 1_401, 'touch'), A)).toBe(false);
  });

  it('pairs a finger’s two presses on empty board, never one on board with one on an object', () => {
    const onBoard = stampOf(press(100, 1_000, 'touch'), null);
    expect(isDoublePress(onBoard, press(110, 1_200, 'touch'), null)).toBe(true);
    expect(isDoublePress(onBoard, press(110, 1_200, 'touch'), A)).toBe(false);
    const onObject = stampOf(press(100, 1_000, 'touch'), A);
    expect(isDoublePress(onObject, press(110, 1_200, 'touch'), null)).toBe(false);
  });
});

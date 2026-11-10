// A finger's inputs to the select tool's state machine, for its touch tests: the camera at the
// origin at 100%, so screen and world points are the same.
import type { Point } from '@canvas/schema';

import type { SelectInput } from '../select-input.js';

/**
 * A finger's input at a world point, the camera at the origin at 100% (screen = world).
 *
 * @param kind - Down, move or up.
 * @param point - The point, world units and CSS px alike.
 * @param timeStamp - When, ms.
 * @returns The input.
 */
export function finger(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  point: Point,
  timeStamp = 0,
): SelectInput {
  return {
    kind,
    screen: point,
    world: point,
    isShiftPressed: false,
    isModPressed: false,
    pointerType: 'touch',
    timeStamp,
  };
}

/**
 * The input sent when a press has been held until `timeStamp`, the finger where it landed.
 *
 * @param timeStamp - The time now, ms.
 * @param screen - Where the finger is now; (10, 10) by default.
 * @returns The input.
 */
export function hold(timeStamp: number, screen: Point = { x: 10, y: 10 }): SelectInput {
  return { kind: 'hold', timeStamp, screen };
}

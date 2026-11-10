import type { Point } from '@canvas/schema';

import { normalizeAngle } from './oriented-box.js';

/** The step Shift snaps rotation to: 15°, in radians. */
export const ROTATION_SNAP_STEP = Math.PI / 12;

/**
 * The angle a rotation drag (from a corner's rotation band) turns the selection by: the angle
 * swept about the pivot from the press to the pointer, clockwise on screen, the short way round.
 * With Shift the frame's resulting rotation snaps to a multiple of 15°, so one object lands on 0°,
 * 15°, 30°…; a multi-selection's frame starts at 0°, so its turn snaps to 15° steps. Pure.
 *
 * @param pivot - The centre of the turn, world units.
 * @param from - Where the drag started, world units.
 * @param to - The pointer now, world units.
 * @param frameRotation - The frame's rotation before the drag, radians.
 * @param isSnapped - Whether Shift is held.
 * @returns The angle, radians; 0 when the pointer is on the pivot.
 */
export function rotationAngle(
  pivot: Point,
  from: Point,
  to: Point,
  frameRotation: number,
  isSnapped: boolean,
): number {
  if (to.x === pivot.x && to.y === pivot.y) return 0;
  const swept = normalizeAngle(
    Math.atan2(to.y - pivot.y, to.x - pivot.x) - Math.atan2(from.y - pivot.y, from.x - pivot.x),
  );
  if (!isSnapped) return swept;
  const target = Math.round((frameRotation + swept) / ROTATION_SNAP_STEP) * ROTATION_SNAP_STEP;
  return target - frameRotation;
}

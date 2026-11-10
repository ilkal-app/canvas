import type { Point } from '@canvas/schema';

/** The angle a Shift-constrained line end steps by: 45°, in radians. */
export const LINE_ANGLE_STEP = Math.PI / 4;

/**
 * Where a line end goes while Shift is held: turned
 * about the fixed end to the nearest multiple of 45°, at the same distance from it, so the line
 * is horizontal, vertical or diagonal and as long as the pointer made it. Pure.
 *
 * @param fixed - The end that stays, world units.
 * @param moving - Where the pointer puts the other end, world units.
 * @returns The constrained end; `moving` itself when it is on the fixed end.
 */
export function constrainLineEnd(fixed: Point, moving: Point): Point {
  const dx = moving.x - fixed.x;
  const dy = moving.y - fixed.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: moving.x, y: moving.y };
  const angle = Math.round(Math.atan2(dy, dx) / LINE_ANGLE_STEP) * LINE_ANGLE_STEP;
  return { x: fixed.x + Math.cos(angle) * length, y: fixed.y + Math.sin(angle) * length };
}

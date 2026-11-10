import type { Point } from '@canvas/schema';

/** A 45° step, radians. */
const STEP = Math.PI / 4;

/**
 * Turns a point about an origin onto the nearest multiple of 45°, keeping its distance (Shift
 * while placing a pen point or dragging a handle; the prototype's `constrain45`,
 * webgl-whiteboard `src/vector/snap.ts`). Pure.
 *
 * @param origin - The fixed point: the previous vertex, or the vertex a handle belongs to.
 * @param point - The point to constrain.
 * @returns The constrained point; the origin itself for a point on it.
 */
export function constrain45(origin: Point, point: Point): Point {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: origin.x, y: origin.y };
  const angle = Math.round(Math.atan2(dy, dx) / STEP) * STEP;
  return { x: origin.x + Math.cos(angle) * length, y: origin.y + Math.sin(angle) * length };
}

import { z } from 'zod';

/**
 * The bound of the board, in world units: 2^30 = 1,073,741,824. It bounds
 * where objects are **on the board**: each of the four extents of an object's axis-aligned box in
 * the board's frame (rotation applied; a line's or path's points) obeys
 * `|after| <= max(BOARD_BOUND, |before|)` for every object a command changes or carries, so an
 * extent inside the bound may go anywhere inside it, and one past it may stay or come inward,
 * never go further out. Stored, parent-relative numbers are not bounded by it, only held finite:
 * a member of a group of two frames at -B and +B honestly stores about 2B. Values that are not
 * positions (a rotation, a corner radius, a natural size, a comment pin's offset) have limits of
 * their own (`findValueLimitIssues`).
 *
 * Why this number: coordinate arithmetic stays exact in float64 (a sum of a few values at the
 * bound is an integer below 2^53, and a coordinate at the bound keeps 22 fraction bits) and every
 * quantity a renderer forms from them (a far corner at zoom 64, the squared distance between two
 * opposite corners) is finite in float32, whose largest value is about 3.4e38. Without a bound a
 * stored `1e308` is finite, yet the width of a box between two far points overflows to
 * `Infinity`, which poisons bounds, the spatial index and the GPU buffers.
 */
export const BOARD_BOUND = 2 ** 30;

/**
 * Validates an angle in radians a new object is created with: finite and within ±{@link BOARD_BOUND}
 * (about 170 million turns), the limit a rotation has on every way in (`findValueLimitIssues`).
 * Sums of two angles at the limit stay finite, which a bare number's `1e308 + 1e308` does not.
 */
export const angleSchema = z
  .number()
  .min(-BOARD_BOUND, `must be within ±${String(BOARD_BOUND)} radians`)
  .max(BOARD_BOUND, `must be within ±${String(BOARD_BOUND)} radians`)
  .describe(`An angle in radians, within ±${String(BOARD_BOUND)}.`);

/**
 * Makes a computed coordinate storable: a finite value is returned as it is, even past
 * ±{@link BOARD_BOUND}, and only what is not finite is clamped (an infinity to the largest finite
 * number on its side, NaN to 0). For positions a command or the schema derives from stored data
 * (a connector end or a comment pin detached where it was, a coordinate re-expressed in another
 * frame): the store holds only finite numbers, and the bound judges where objects land on the
 * board, not the numbers that place them.
 *
 * @param value - A computed coordinate, world units.
 * @returns The value when it is finite, else a finite stand-in.
 */
export function finiteCoordinate(value: number): number {
  if (Number.isFinite(value)) return value;
  if (Number.isNaN(value)) return 0;
  return value > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE;
}

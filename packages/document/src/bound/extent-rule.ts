import { BOARD_BOUND, EXTENT_NAMES, type ExtentName } from '@canvas/schema';

import type { WorldBox } from './world-box.js';

/** A change that pushes no extent of an object's box out (`judgeExtents`). */
export interface ExtentsWithin {
  /** Nothing is pushed out. */
  readonly kind: 'within';
}

/** A change that pushes extents of an object's box further past the bound (`judgeExtents`). */
export interface ExtentsOutward {
  /** These extents end further past the bound than they were. */
  readonly kind: 'outward';
  /** The extents, in `EXTENT_NAMES` order. */
  readonly extents: readonly ExtentName[];
}

/** A change that leaves an object that had a place with none that can be worked out. */
export interface PlaceLost {
  /** The object had a place that could be worked out, and would have none. */
  readonly kind: 'unplaceable';
}

/**
 * What a change of an object's place on the board does to the board's bound (rule 1):
 * nothing, the extents it pushes out, or that it leaves the object with no place that can be
 * worked out.
 */
export type ExtentVerdict = ExtentsWithin | ExtentsOutward | PlaceLost;

/**
 * The relative slack of the board's bound, 2^-40: an extent may end at most
 * `max(BOARD_BOUND, |before|) × (1 + BOUND_SLACK)` from the origin, about a thousandth of a world
 * unit at the bound. Why: a move or turn inside a turned frame goes through the frame's transform
 * and back, and the rounding of that round trip (a few ulps, 2^-52 each) can leave an extent that
 * did not move, or moved inward, one ulp further out; the exact rule refused about one in eight
 * such inward moves and moves to (B, y). The slack is thousands of ulps and still far below any
 * real step: a step of a thousandth of a unit outward is refused. A relay applying the rule to
 * stored states uses the same slack, which also covers the rounding of a group's or an ungroup's
 * re-expression.
 */
export const BOUND_SLACK = 2 ** -40;

/** The verdict of a change that pushes nothing out. */
const WITHIN: ExtentVerdict = Object.freeze({ kind: 'within' });

/**
 * THE RULE of the board's bound: for each of the four extents of
 * an object's box on the board, `|after| <= max(BOARD_BOUND, |before|)`. An extent inside the bound
 * may go anywhere inside it; one past it may stay or come inward, never go further out. The box
 * holds the object's origin as well as its geometry (`worldBoxAt`), so an object with no geometry
 * of its own (an empty group) is held by its placement. A new object, or one whose box
 * could not be worked out, is held to the bound itself. An object whose box cannot be worked out after the change breaks
 * the rule unless it could not be worked out before either (nothing got worse). Up to rounding:
 * the limit is widened by {@link BOUND_SLACK}, so an inward move is never refused for the ulp its
 * arithmetic adds, and a relay deciding from stored states alone decides as a command does.
 *
 * @param before - Where the object was, or `undefined` for a new object.
 * @param after - Where it would be.
 * @returns The verdict.
 */
export function judgeExtents(before: WorldBox | undefined, after: WorldBox): ExtentVerdict {
  if (after.kind === 'unplaceable') {
    return before?.kind === 'unplaceable' ? WITHIN : { kind: 'unplaceable' };
  }
  const extents = EXTENT_NAMES.filter((name) => {
    const reach =
      before?.kind === 'box' ? Math.max(BOARD_BOUND, Math.abs(before.box[name])) : BOARD_BOUND;
    return Math.abs(after.box[name]) > reach * (1 + BOUND_SLACK);
  });
  return extents.length === 0 ? WITHIN : { kind: 'outward', extents };
}

/**
 * Tells whether a box is past the board's bound, or cannot be worked out: what makes an object
 * far (`isFarObject`). With the same slack as the rule ({@link BOUND_SLACK}), so an object an
 * honest command left an ulp past B is not far.
 *
 * @param where - Where the object is.
 * @returns `true` when an extent is past ±`BOARD_BOUND` (with the slack), or its box cannot be
 *   worked out.
 */
export function isPastBound(where: WorldBox): boolean {
  if (where.kind === 'unplaceable') return true;
  const limit = BOARD_BOUND * (1 + BOUND_SLACK);
  return EXTENT_NAMES.some((name) => Math.abs(where.box[name]) > limit);
}

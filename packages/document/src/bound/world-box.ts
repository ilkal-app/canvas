import {
  boardTransformOf,
  geometryBoxOf,
  isFiniteBox,
  isFiniteTransform,
  type BoardObject,
  type ExtentBox,
  type RigidTransform,
} from '@canvas/schema';

import type { BoxSource } from './box-source.js';

/**
 * Where an object is on the board: the axis-aligned box in the board's frame of its
 * geometry (rotation applied; for a line or a path the box of its points and vertices) and of its
 * placement, its own origin, which counts as a point of it (item 4: placement is bounded
 * regardless of extent, so an empty group, or a line whose origin is far and whose ends bring it
 * back, is where its origin is too); or that its box cannot be worked out (a parent cycle, or a
 * number it needs, its own or an ancestor's, that is not finite or overflows).
 */
export type WorldBox =
  | {
      /** It has a box on the board, every extent finite. */
      readonly kind: 'box';
      /** The box, world units in the board's frame. */
      readonly box: ExtentBox;
    }
  | {
      /** Its box cannot be worked out. */
      readonly kind: 'unplaceable';
    };

/** The {@link WorldBox} of an object whose box cannot be worked out. */
export const UNPLACEABLE: WorldBox = Object.freeze({ kind: 'unplaceable' });

/**
 * An object's box on the board, from the transform that places its own frame there: the box of
 * its geometry and its origin (the transform's translation), or only its origin when it has no
 * geometry of its own (a group, a comment pinned to an object, a connector with no free end).
 *
 * @param object - The object.
 * @param transform - The transform from its own frame to the board's, or `undefined` when it
 *   cannot be worked out; one that is not finite cannot either.
 * @returns Where it is.
 */
export function worldBoxAt(object: BoardObject, transform: RigidTransform | undefined): WorldBox {
  if (transform === undefined || !isFiniteTransform(transform)) return UNPLACEABLE;
  const { x, y } = transform;
  const geometry = geometryBoxOf(object, transform);
  const box: ExtentBox =
    geometry === undefined
      ? { minX: x, maxX: x, minY: y, maxY: y }
      : {
          minX: Math.min(geometry.minX, x),
          maxX: Math.max(geometry.maxX, x),
          minY: Math.min(geometry.minY, y),
          maxY: Math.max(geometry.maxY, y),
        };
  return isFiniteBox(box) ? { kind: 'box', box } : UNPLACEABLE;
}

/**
 * Where an object is on the board: its box through its chain of parents
 * (`boardTransformOf`, O(depth)). The one function the command layer's bound, the select tool's
 * far test and the sync fuzz's model of the bound all measure with, so they cannot disagree. A
 * relay judging a peer's update calls it on the board before and after the update.
 *
 * @param source - The board.
 * @param object - The object, as the board holds it.
 * @returns Where it is.
 */
export function worldBoxOf(source: Pick<BoxSource, 'get'>, object: BoardObject): WorldBox {
  return worldBoxAt(
    object,
    boardTransformOf(object, (id) => source.get(id)),
  );
}

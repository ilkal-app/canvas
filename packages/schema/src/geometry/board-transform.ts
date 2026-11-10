import type { Board } from '../board/board.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';

import {
  composeTransforms,
  IDENTITY_TRANSFORM,
  placementTransform,
  type RigidTransform,
} from './rigid-transform.js';

/**
 * The transform from an object's own frame to the board's frame: its placement composed with
 * every ancestor's, up to the root. A `parentId` that names no object on the board is treated as
 * the root; `validateBoard` reports it.
 *
 * @param board - The board holding the object and its ancestors.
 * @param object - The object whose frame to map.
 * @returns The object-to-board transform.
 * @throws {RangeError} When the object's ancestors form a cycle, which has no board frame.
 */
export function objectToBoardTransform(board: Board, object: BoardObject): RigidTransform {
  let transform = placementTransform(object.x, object.y, object.rotation);
  const visited = new Set<ObjectId>([object.id]);
  let parentId = object.parentId;
  while (parentId !== null) {
    const parent = board.objects.get(parentId);
    if (parent === undefined) break;
    if (visited.has(parent.id)) {
      throw new RangeError(`The ancestors of "${object.id}" form a cycle through "${parent.id}"`);
    }
    visited.add(parent.id);
    transform = composeTransforms(
      placementTransform(parent.x, parent.y, parent.rotation),
      transform,
    );
    parentId = parent.parentId;
  }
  return transform;
}

/**
 * The transform from the frame of an object's parent to the board's frame: the identity for an
 * object at the root.
 *
 * @param board - The board holding the object's ancestors.
 * @param object - The object whose parent frame to map.
 * @returns The parent-to-board transform.
 * @throws {RangeError} When the object's ancestors form a cycle.
 */
export function parentToBoardTransform(board: Board, object: BoardObject): RigidTransform {
  const parent = object.parentId === null ? undefined : board.objects.get(object.parentId);
  if (parent === undefined) return IDENTITY_TRANSFORM;
  if (parent.id === object.id) {
    throw new RangeError(`"${object.id}" is its own parent`);
  }
  return objectToBoardTransform(board, parent);
}
